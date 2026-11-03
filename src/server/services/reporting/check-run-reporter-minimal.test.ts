// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { z } from 'zod';
import { json, line, type RouteCall } from '../../adapters/github/client-fixture/test-support.ts';
import { GitHubRateLimitedError } from '../ports/github-errors.ts';
import { ReportRejectedError } from '../ports/reporter.ts';
import { created, inOrder, PATCH, POST, RUN, refused, scripted, updated } from './scripted-github/test-support.ts';
import { FAILING, HEAD, INSTALLATION, PASSING } from './test-support.ts';

// The minimal-output fallback (E09-S06): when a `POST` or a `PATCH` is answered 422, the write is repeated once with the title
// and a summary of at most 500 characters that holds the counts and the `/recheck` hint, no names. If that is refused too, the
// report ends in a ReportRejectedError. The conclusion is always sent, so rejected text never leaves a run pending.

const NAMES = { logins: new Map([[1, '@everyone']]), coAuthors: new Map<string, string[]>() };
const unprocessable = refused(422);

const Sent = z.object({
  name: z.string().optional(),
  head_sha: z.string().optional(),
  status: z.string(),
  conclusion: z.string().optional(),
  completed_at: z.string().optional(),
  external_id: z.string().optional(),
  details_url: z.string().optional(),
  output: z.object({ title: z.string(), summary: z.string(), text: z.string().optional() }),
});

/** The body of a request, as the adapter sent it. */
const bodyOf = (call: RouteCall | undefined) => Sent.parse(JSON.parse(call?.body ?? '{}'));

test('a 422 to the verdict is followed by one minimal POST with the counts and the hint, the same conclusion and no name', async () => {
  const { world, calls } = await scripted({ [POST]: inOrder(unprocessable, created) });
  const target = await world.evaluation();
  expect(await world.reporter.publish(target, FAILING, NAMES)).toEqual({ status: 'reported' });
  expect(calls.map(line)).toEqual([
    `GET /repos/org-1/repo/commits/${HEAD}/check-runs?check_name=license%2Fcla&filter=latest&per_page=100`,
    'POST /repos/org-1/repo/check-runs',
    `GET /repos/org-1/repo/commits/${HEAD}/check-runs?check_name=license%2Fcla&filter=latest&per_page=100`,
    'POST /repos/org-1/repo/check-runs',
    'GET /repos/org-1/repo/issues/7/comments?per_page=100&page=1',
    'POST /repos/org-1/repo/issues/7/comments',
  ]);
  const [first, second] = calls
    .filter((call) => call.method === 'POST' && call.path.endsWith('/check-runs'))
    .map((call) => bodyOf(call));
  expect(first?.output.summary).toContain('everyone');
  expect(second).toEqual({
    status: 'completed',
    conclusion: 'failure',
    completed_at: '2026-11-02T10:00:00.000Z',
    external_id: String(target.evaluationId),
    details_url: 'https://cla.example.org/sign/9000?pr=7',
    head_sha: HEAD,
    name: 'license/cla',
    output: {
      title: 'CLA signature required: 1 unsigned',
      summary:
        'The CLA check did not pass for commit 0000000 (1 unsigned). The details could not be shown here. Comment `/recheck` to run it again.',
    },
  });
  expect(JSON.stringify(second)).not.toContain('everyone');
  expect((await world.rows()).map((row) => row.check_run_id)).toEqual([RUN.id]);
});

test('the minimal summary of a pass holds the counts and the hint, and the conclusion is still success', async () => {
  const { world, calls } = await scripted({ [POST]: inOrder(unprocessable, created) });
  const target = await world.evaluation();
  await world.reporter.publish(target, PASSING, NAMES);
  const minimal = bodyOf(calls.findLast((call) => call.method === 'POST' && call.path.endsWith('/check-runs')));
  expect(minimal).toMatchObject({
    status: 'completed',
    conclusion: 'success',
    output: {
      title: 'CLA check passed',
      summary: '1 contributor covered: 1 by signature. Comment `/recheck` to run it again.',
    },
  });
  expect(minimal.output.summary.length).toBeLessThanOrEqual(500);
});

test('a 422 to the minimal output too is a ReportRejectedError after exactly two attempts, with the first 422 logged', async () => {
  const { world, calls } = await scripted({ [POST]: unprocessable });
  const target = await world.evaluation();
  const failure = await world.reporter.publish(target, FAILING, NAMES).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(ReportRejectedError);
  expect(failure).toMatchObject({
    rejection: 'output_rejected',
    message: 'GitHub refused the report (output_rejected)',
  });
  expect(calls.filter((call) => call.method === 'POST')).toHaveLength(2);
  expect(world.logs.lines().map((entry) => [entry['msg'], entry['statusCode']])).toEqual(
    expect.arrayContaining([
      ['report.output_rejected', 422],
      ['report.minimal_output_rejected', 422],
    ]),
  );
  expect(world.logs.lines().find((entry) => entry['msg'] === 'report.minimal_output_rejected')).toMatchObject({
    githubInstallationId: INSTALLATION,
    githubRepoId: 9000,
    prNumber: 7,
    headSha: HEAD,
  });
  expect(world.logs.text()).not.toMatch(/LEAKED|everyone/u);
  expect((await world.rows()).map((row) => row.check_run_id)).toEqual([null]);
});

test('a PATCH and then the POST that replaces it answered 422 are followed by a minimal PATCH that completes the run', async () => {
  const { world, calls } = await scripted({
    [PATCH]: inOrder(unprocessable, updated),
    [POST]: inOrder(created, unprocessable),
  });
  const target = await world.evaluation();
  await world.reporter.started(target);
  calls.length = 0;
  expect(await world.reporter.publish(target, FAILING, NAMES)).toEqual({ status: 'reported' });
  expect(calls.map(line)).toEqual([
    'GET /repos/org-1/repo/check-runs/9000001',
    'PATCH /repos/org-1/repo/check-runs/9000001',
    'POST /repos/org-1/repo/check-runs',
    'GET /repos/org-1/repo/check-runs/9000001',
    'PATCH /repos/org-1/repo/check-runs/9000001',
    'GET /repos/org-1/repo/issues/7/comments?per_page=100&page=1',
    'POST /repos/org-1/repo/issues/7/comments',
  ]);
  const last = bodyOf(calls.findLast((call) => call.method === 'PATCH'));
  expect(last).toMatchObject({ status: 'completed', conclusion: 'failure' });
  expect(last.output.text).toBeUndefined();
  expect(last.output.summary).not.toContain('everyone');
});

test('a 422 to the in-progress run of started is retried once with the same fixed words and then rejected', async () => {
  const { world, calls } = await scripted({ [POST]: unprocessable });
  const target = await world.evaluation();
  await expect(world.reporter.started(target)).rejects.toBeInstanceOf(ReportRejectedError);
  expect(calls.filter((call) => call.method === 'POST').map((call) => bodyOf(call).output)).toEqual([
    {
      title: 'Checking CLA signatures',
      summary: 'Evaluating commit 0000000. This updates automatically. Comment `/recheck` to run it again.',
    },
    {
      title: 'Checking CLA signatures',
      summary: 'Evaluating commit 0000000. This updates automatically. Comment `/recheck` to run it again.',
    },
  ]);
});

test('a failure of the minimal retry that is not a 422 is thrown as it is, for the queue to retry', async () => {
  const { world, calls } = await scripted({
    [POST]: inOrder(unprocessable, () => json({ message: 'slow down' }, 429, { 'retry-after': '120' })),
  });
  const target = await world.evaluation();
  const failure = await world.reporter.publish(target, FAILING, NAMES).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(GitHubRateLimitedError);
  expect(failure).toMatchObject({ retryAfterSeconds: 120 });
  expect(failure).not.toBeInstanceOf(ReportRejectedError);
  expect(calls.filter((call) => call.method === 'POST')).toHaveLength(2);
});
