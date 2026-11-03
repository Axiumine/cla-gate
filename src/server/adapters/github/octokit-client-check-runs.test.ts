// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { CHECK_RUN_NAME } from '../../../shared/check.ts';
import { parseGithubId } from '../../../shared/github-id.ts';
import { PASSED, STARTED } from '../../services/github-check-contract/test-support.ts';
import { commitSha } from '../../services/github-pull-contract/test-support.ts';
import type { CheckRunWrite } from '../../services/ports/github.ts';
import {
  GitHubForbiddenError,
  GitHubNotFoundError,
  GitHubUnavailableError,
  GitHubUnprocessableError,
} from '../../services/ports/github-errors.ts';
import { clientFixture, json, line, type Routes } from './client-fixture/test-support.ts';

// What the Octokit adapter sends for the Check Run calls (E09-S05) and how it reads what GitHub can answer that a port type
// cannot hold: the fields of the run it keeps, a state of another App's run it has no word for, an answer that is not a run.
// What both implementations answer to well-formed data is in the contract suite.

const id = parseGithubId;
const SHA = commitSha(2);
const POST = 'POST /repos/:owner/:repo/check-runs';
const PATCH = 'PATCH /repos/:owner/:repo/check-runs/:id';
const GET = 'GET /repos/:owner/:repo/check-runs/:id';
const LIST = 'GET /repos/:owner/:repo/commits/:sha/check-runs';

/** A Check Run as GitHub spells it, with fields the platform does not use. */
function runJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 55,
    node_id: 'CR_kwDO',
    head_sha: SHA,
    name: CHECK_RUN_NAME,
    status: 'in_progress',
    conclusion: null,
    external_id: '17',
    details_url: 'https://example.org/sign/1',
    started_at: '2026-11-02T10:00:00Z',
    output: { title: 'x', summary: 'y', text: null, annotations_count: 0 },
    app: { id: 4242, slug: 'cla-gate-test', name: 'CLA Gate Test', owner: { id: 9001 } },
    pull_requests: [],
    ...overrides,
  };
}

/** The body of the request of a call, read as data. */
function bodyOf(body: string): unknown {
  return JSON.parse(body);
}

test('a run is created with the installation token and carries the name of the check, the commit, the state, the start and the output, and nothing else', async () => {
  const { client, calls } = clientFixture({ [POST]: () => json(runJson(), 201) });
  const run = await client.createCheckRun(id(11), 'acme/api', SHA, STARTED);
  expect(run).toEqual({ id: 55, headSha: SHA, status: 'in_progress', appId: 4242, externalId: '17' });
  expect(calls.map(line)).toEqual(['POST /repos/acme/api/check-runs']);
  expect(calls.map((call) => call.headers.get('authorization'))).toEqual(['Bearer ghs_made-up-11-1']);
  expect(bodyOf(calls[0]?.body ?? '')).toEqual({
    name: CHECK_RUN_NAME,
    head_sha: SHA,
    status: 'in_progress',
    started_at: '2026-11-02T10:00:00.000Z',
    external_id: '17',
    output: { title: 'Checking CLA signatures', summary: 'Evaluating commit 0000002.' },
  });
});

test('a completed run is created with its conclusion, completion time, details link and the text of the output', async () => {
  const { client, calls } = clientFixture({ [POST]: () => json(runJson({ status: 'completed' }), 201) });
  const write: CheckRunWrite = { ...PASSED, text: 'The details.', detailsUrl: 'https://example.org/sign/1' };
  await client.createCheckRun(id(11), 'acme/api', SHA, write);
  expect(bodyOf(calls[0]?.body ?? '')).toEqual({
    name: CHECK_RUN_NAME,
    head_sha: SHA,
    status: 'completed',
    conclusion: 'success',
    completed_at: '2026-11-02T10:01:00.000Z',
    details_url: 'https://example.org/sign/1',
    output: { title: 'CLA check passed', summary: '1 contributor covered: 1 by signature.', text: 'The details.' },
  });
});

test('a run is updated by its id and the start time, the name and the commit are not sent again', async () => {
  const { client, calls } = clientFixture({
    [GET]: () => json({ message: 'the GET handler is tried first for a PATCH and must let it through' }, 500),
    [PATCH]: () => json(runJson({ status: 'completed' })),
  });
  const run = await client.updateCheckRun(id(11), 'acme/api', id(55), { ...STARTED, ...PASSED });
  expect(run.status).toBe('completed');
  expect(calls.map(line)).toEqual(['PATCH /repos/acme/api/check-runs/55']);
  expect(bodyOf(calls[0]?.body ?? '')).toEqual({
    status: 'completed',
    conclusion: 'success',
    completed_at: '2026-11-02T10:01:00.000Z',
    external_id: '17',
    output: { title: 'CLA check passed', summary: '1 contributor covered: 1 by signature.' },
  });
});

test('a run is read by its id and the commit listing asks for the latest runs of this check, 100 to a page', async () => {
  const { client, calls } = clientFixture({
    [GET]: () => json(runJson()),
    [LIST]: () => json({ total_count: 2, check_runs: [runJson({ id: 56 }), runJson({ id: 55 })] }),
  });
  expect(await client.getCheckRun(id(11), 'acme/api', id(55))).toEqual({
    id: 55,
    headSha: SHA,
    status: 'in_progress',
    appId: 4242,
    externalId: '17',
  });
  const listed = await client.listCheckRunsForRef(id(11), 'acme/api', SHA);
  expect(listed.map((run) => run.id)).toEqual([56, 55]);
  expect(calls.map(line)).toEqual([
    'GET /repos/acme/api/check-runs/55',
    `GET /repos/acme/api/commits/${SHA}/check-runs?check_name=license%2Fcla&filter=latest&per_page=100`,
  ]);
});

test.each([
  ['a state of another App it has no word for', { status: 'waiting' }, { status: 'queued' }],
  ['a state of a type it cannot read', { status: 7 }, { status: 'queued' }],
  ['a deleted App', { app: null }, { appId: null }],
  ['no App', { app: undefined }, { appId: null }],
  ['no external id', { external_id: undefined }, { externalId: null }],
  ['a null external id', { external_id: null }, { externalId: null }],
])('a run with %s is read as %j', async (_name, overrides, expected) => {
  const { client } = clientFixture({ [GET]: () => json(runJson(overrides)) });
  expect(await client.getCheckRun(id(11), 'acme/api', id(55))).toMatchObject(expected);
});

test.each([
  ['an id of zero', { id: 0 }],
  ['a head that is not a commit SHA', { head_sha: 'main' }],
  ['no head', { head_sha: undefined }],
  ['no state', { status: undefined }],
  ['an external id that is a number', { external_id: 17 }],
  ['an App without a numeric id', { app: { slug: 'x' } }],
])('a run with %s is a GitHubResponseError that names the route, never the answer', async (_name, overrides) => {
  const { client } = clientFixture({ [GET]: () => json(runJson(overrides)) });
  await expect(client.getCheckRun(id(11), 'acme/api', id(55))).rejects.toMatchObject({
    name: 'GitHubResponseError',
    route: 'GET /repos/{owner}/{repo}/check-runs/{check_run_id}',
  });
});

test('a listing that is not a list of runs is a GitHubResponseError', async () => {
  const { client } = clientFixture({ [LIST]: () => json({ total_count: 0, check_runs: 'none' }) });
  await expect(client.listCheckRunsForRef(id(11), 'acme/api', SHA)).rejects.toMatchObject({
    name: 'GitHubResponseError',
    route: 'GET /repos/{owner}/{repo}/commits/{ref}/check-runs',
  });
});

const REFUSALS: [name: string, status: number, expected: abstract new (...args: never[]) => Error][] = [
  ['404', 404, GitHubNotFoundError],
  ['a 403 that is a refusal', 403, GitHubForbiddenError],
  ['422', 422, GitHubUnprocessableError],
  ['502', 502, GitHubUnavailableError],
];

test.each(REFUSALS)(
  'a %s to the creation of a run leaves as the right error and is sent once',
  async (_name, status, expected) => {
    const { client, calls } = clientFixture({ [POST]: () => json({ message: 'LEAKED' }, status) });
    const failure = await client.createCheckRun(id(11), 'acme/api', SHA, STARTED).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(expected);
    expect(String(failure)).not.toContain('LEAKED');
    expect(calls).toHaveLength(1);
  },
);

test.each(REFUSALS)(
  'a %s to the update of a run leaves as the right error and is sent once',
  async (_name, status, expected) => {
    const { client, calls } = clientFixture({ [PATCH]: () => json({ message: 'LEAKED' }, status) });
    const failure = await client.updateCheckRun(id(11), 'acme/api', id(55), PASSED).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(expected);
    expect(String(failure)).not.toContain('LEAKED');
    expect(calls).toHaveLength(1);
  },
);

test('a run GitHub answers 404 to is null, a 403 is a refusal and a listing of a missing repository is a 404', async () => {
  const routes: Routes = {
    [GET]: (call) => (call.path.endsWith('/55') ? json({ message: 'Not Found' }, 404) : json({}, 403)),
    [LIST]: () => json({ message: 'Not Found' }, 404),
  };
  const { client } = clientFixture(routes);
  expect(await client.getCheckRun(id(11), 'acme/api', id(55))).toBeNull();
  await expect(client.getCheckRun(id(11), 'acme/api', id(56))).rejects.toBeInstanceOf(GitHubForbiddenError);
  await expect(client.listCheckRunsForRef(id(11), 'acme/api', SHA)).rejects.toBeInstanceOf(GitHubNotFoundError);
});

test('what no request can carry never reaches the network: a name or a SHA that GitHub cannot hold is answered without one', async () => {
  const { client, calls } = clientFixture({});
  await expect(client.createCheckRun(id(11), '../orgs/x', SHA, STARTED)).rejects.toBeInstanceOf(GitHubNotFoundError);
  await expect(client.createCheckRun(id(11), 'acme/api', 'main?x=1', STARTED)).rejects.toBeInstanceOf(
    GitHubNotFoundError,
  );
  await expect(client.updateCheckRun(id(11), 'acme/api/../x', id(55), PASSED)).rejects.toBeInstanceOf(
    GitHubNotFoundError,
  );
  await expect(client.listCheckRunsForRef(id(11), 'acme/..', SHA)).rejects.toBeInstanceOf(GitHubNotFoundError);
  expect(await client.getCheckRun(id(11), 'acme/api/../x', id(55))).toBeNull();
  expect(await client.listCheckRunsForRef(id(11), 'acme/api', `${SHA}/../x`)).toEqual([]);
  expect(calls).toEqual([]);
});
