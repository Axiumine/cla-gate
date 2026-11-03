// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { httpWorld } from '../../adapters/github/http-world/test-support.ts';
import { testGitHubKey } from '../../config/test-support.ts';
import { comment } from '../github-comment-contract/test-support.ts';
import { installation, repository } from '../github-contract/test-support.ts';
import {
  FAILING,
  FULL_NAME,
  HEAD,
  INSTALLATION,
  NAMES,
  PASSING,
  REPOSITORY,
  reportingWorld,
  withoutTrigger,
} from './test-support.ts';

// The reporter on the real Octokit adapter, over HTTP with MSW (E09-S05): the requests it makes for the lifecycle of a Check
// Run, in order, with the installation token of the tenant (and, E09-S06, the idempotency of the reports and the rewrite of a
// comment). The cases of the lifecycle are in the other files, on FakeGitHub.

const signer = testGitHubKey();
const LISTING = `GET /repos/${FULL_NAME}/commits/${HEAD}/check-runs?check_name=license%2Fcla&filter=latest&per_page=100`;

/** The world: MSW serving the tenant, and a reporter whose client is the adapter. */
async function adapterWorld() {
  const github = await httpWorld(signer);
  github.addInstallation(installation(INSTALLATION, 'org-1'), [repository(REPOSITORY, FULL_NAME)]);
  const world = await reportingWorld({ github: github.client });
  /** The requests that were about the Check Run: the token mint is the adapter's own business. */
  const checkRequests = () => github.requests.filter((request) => !request.includes('/app/'));
  return { world, github, checkRequests };
}

test('a first run is listed for, created, and then read and updated by its id when the verdict comes', async () => {
  const { world, github, checkRequests } = await adapterWorld();
  const target = await world.evaluation();
  await world.reporter.started(target);
  await world.reporter.publish(target, FAILING, NAMES);
  expect(checkRequests()).toEqual([
    LISTING,
    `POST /repos/${FULL_NAME}/check-runs`,
    `GET /repos/${FULL_NAME}/check-runs/9000001`,
    `PATCH /repos/${FULL_NAME}/check-runs/9000001`,
  ]);
  const runs = await github.client.listCheckRunsForRef(INSTALLATION, FULL_NAME, HEAD);
  expect(runs).toEqual([
    { id: 9_000_001, headSha: HEAD, status: 'completed', appId: 4242, externalId: String(target.evaluationId) },
  ]);
  expect((await world.rows()).map((row) => row.check_run_id)).toEqual([9_000_001]);
});

test('a job retried after a crash finds the run in the listing and creates no second one', async () => {
  const { world, github, checkRequests } = await adapterWorld();
  const target = await world.evaluation();
  await world.reporter.started(target);
  await sql`update pr_evaluations set check_run_id = null`.execute(world.db);
  await world.reporter.started(target);
  expect(checkRequests()).toEqual([LISTING, `POST /repos/${FULL_NAME}/check-runs`, LISTING]);
  expect(await github.client.listCheckRunsForRef(INSTALLATION, FULL_NAME, HEAD)).toHaveLength(1);
});

test('a verdict with no run on the SHA creates a run that is already completed, and a second verdict updates it', async () => {
  const { world, github, checkRequests } = await adapterWorld();
  const target = await world.evaluation();
  await world.reporter.publish(target, PASSING, NAMES);
  await world.reporter.publish(target, PASSING, NAMES);
  expect(checkRequests()).toEqual([
    LISTING,
    `POST /repos/${FULL_NAME}/check-runs`,
    `GET /repos/${FULL_NAME}/check-runs/9000001`,
    `PATCH /repos/${FULL_NAME}/check-runs/9000001`,
  ]);
  expect(await github.client.listCheckRunsForRef(INSTALLATION, FULL_NAME, HEAD)).toMatchObject([
    { status: 'completed' },
  ]);
});

test('publish twice leaves exactly one run: one POST, and the second publish is one GET and one PATCH of the run that exists', async () => {
  const { world, github, checkRequests } = await adapterWorld();
  const target = await world.evaluation();
  await world.reporter.started(target);
  await world.reporter.publish(target, FAILING, NAMES);
  await world.reporter.publish(target, FAILING, NAMES);
  const run = `/repos/${FULL_NAME}/check-runs/9000001`;
  expect(checkRequests()).toEqual([
    LISTING,
    `POST /repos/${FULL_NAME}/check-runs`,
    `GET ${run}`,
    `PATCH ${run}`,
    `GET ${run}`,
    `PATCH ${run}`,
  ]);
  expect(await github.client.listCheckRunsForRef(INSTALLATION, FULL_NAME, HEAD)).toMatchObject([
    { id: 9_000_001, status: 'completed' },
  ]);
  expect((await world.rows()).map((row) => row.check_run_id)).toEqual([9_000_001]);
});

test('failed twice, and cancelled after it, are a GET and a PATCH each of the one run and never a second run', async () => {
  const { world, github, checkRequests } = await adapterWorld();
  const target = await world.evaluation();
  await world.reporter.started(target);
  await world.reporter.failed(target, 'evaluation_failed');
  await world.reporter.failed(target, 'evaluation_failed');
  await world.reporter.cancelled(withoutTrigger(target));
  const run = `/repos/${FULL_NAME}/check-runs/9000001`;
  expect(checkRequests()).toEqual([
    LISTING,
    `POST /repos/${FULL_NAME}/check-runs`,
    `GET ${run}`,
    `PATCH ${run}`,
    `GET ${run}`,
    `PATCH ${run}`,
    `GET ${run}`,
  ]);
  expect(await github.client.listCheckRunsForRef(INSTALLATION, FULL_NAME, HEAD)).toHaveLength(1);
});

test('a comment that exists is rewritten through the adapter by one PATCH, and the run ends neutral', async () => {
  const { world, github, checkRequests } = await adapterWorld();
  const target = await world.evaluation({ result: 'failure', commentId: 5001 });
  github.addIssueComment(INSTALLATION, FULL_NAME, comment(5001, { body: 'old text' }));
  expect(await world.reporter.enforcementDisabled(withoutTrigger(target))).toEqual({ status: 'reported' });
  expect(checkRequests()).toEqual([
    LISTING,
    `POST /repos/${FULL_NAME}/check-runs`,
    `PATCH /repos/${FULL_NAME}/issues/comments/5001`,
  ]);
  expect((await github.client.getIssueComment(INSTALLATION, FULL_NAME, parseGithubId(5001)))?.body).toBe(
    '<!-- cla-platform:license/cla:v1 -->\nCLA enforcement is disabled for this repository.',
  );
});
