// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { randomUUID } from 'node:crypto';
import { afterAll, expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { testGitHubKey } from '../../config/test-support.ts';
import { account, pullRequest } from '../../services/github-pull-contract/test-support.ts';
import { registerHandlers } from '../../services/job-handlers.ts';
import { runJob } from '../../services/job-run.ts';
import { queuedJob, runWorld } from '../../services/job-run-fixture/test-support.ts';
import { deliveryRows, sentJobs } from '../../services/jobs-fixture/test-support.ts';
import { TENANT } from '../../services/tenant-fixture/test-support.ts';
import { captureLogs } from '../../test-support.ts';
import { httpWorld } from '../github/http-world/test-support.ts';
import { FIXTURE_IDS, webhookFixture } from '../github/webhook-fixture/test-support.ts';
import { createLogger } from './logger.ts';
import { jobPorts } from './repository-flow-fixture/test-support.ts';
import { deliveryHeaders, postDelivery, SECRET_CURRENT, sharedTenantWebhookApp } from './test-support.ts';

// A `pull_request` delivery for a repository whose enforcement is off (E14-S04): it is recorded and its job is sent and processed
// like any other, and no Check Run is created for it. The mocked GitHub sees no request at all: the job ends before it asks.

const ENV = { GITHUB_WEBHOOK_SECRET: SECRET_CURRENT, GITHUB_APP_ID: String(FIXTURE_IDS.app) };
const FULL_NAME = `account-${String(TENANT.admitted.installation)}/repo`;

let started: ReturnType<typeof sharedTenantWebhookApp> | undefined;
afterAll(async () => {
  await (await started)?.app.close();
});

test('the delivery is recorded and the job processed, and no Check Run is created: the mocked GitHub receives no request', async () => {
  started ??= sharedTenantWebhookApp(ENV);
  const { app, db } = await started;
  const id = randomUUID();
  const text = JSON.stringify(webhookFixture('pull_request'));
  const response = await postDelivery(
    app,
    text,
    deliveryHeaders(text, { headers: { 'x-github-event': 'pull_request', 'x-github-delivery': id } }),
  );
  expect(response.statusCode).toBe(202);
  expect(await deliveryRows(db)).toMatchObject([{ delivery_id: id, event: 'pull_request', processed_at: null }]);
  const [sent] = await sentJobs(db);
  expect(sent?.job).toMatchObject({ type: 'evaluate-pr', githubRepoId: TENANT.admitted.repository, prNumber: 7 });

  const github = await httpWorld(testGitHubKey());
  github.addInstallation(
    {
      id: parseGithubId(TENANT.admitted.installation),
      account: { id: parseGithubId(TENANT.admitted.installation + 1000), login: 'account', type: 'Organization' },
      suspendedAt: null,
      permissions: {},
    },
    [{ id: parseGithubId(TENANT.admitted.repository), fullName: FULL_NAME }],
  );
  github.addPullRequest(
    parseGithubId(TENANT.admitted.installation),
    FULL_NAME,
    pullRequest(7, { opener: account(FIXTURE_IDS.author) }),
  );
  const ports = jobPorts(db, github.client, createLogger({ logLevel: 'info' }, captureLogs().destination));
  const { deps, marked } = runWorld((registry) => {
    registerHandlers(registry, { syncInstallation: undefined, evaluatePr: () => ports });
  });
  const verdict = await runJob('evaluate-pr', queuedJob(sent?.job), deps);
  expect(verdict).toEqual({ status: 'completed', output: { outcome: 'skipped:repository_disabled' } });
  expect(marked).toEqual([id]);
  expect(github.requests).toEqual([]);
  expect(github.requests.filter((request) => request.startsWith('POST') && request.endsWith('/check-runs'))).toEqual(
    [],
  );
  expect(github.checkRunWrites).toEqual([]);
});
