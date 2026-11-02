// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import assert from 'node:assert/strict';
import { expect, test, vi } from 'vitest';
import { buildApp } from '../../app.ts';
import { startGitHubAndDatabase } from '../../boot-services.ts';
import { testGitHubKey } from '../../config/test-support.ts';
import { createJobsTable, fakeEnqueuer } from '../../services/jobs-fixture/test-support.ts';
import { tenantDatabase } from '../../services/tenant-fixture/test-support.ts';
import type { GitHubMethod } from '../../services/test-support.ts';
import { captureLogs, testConfig } from '../../test-support.ts';
import { mockGitHub } from '../github/test-support.ts';
import { FIXTURE_IDS } from '../github/webhook-fixture/test-support.ts';
import { createLogger } from './logger.ts';
import { postDelivery, SECRET_CURRENT } from './test-support.ts';
import { deliveryOf, ROUTING_ROWS } from './webhook-table-fixture/test-support.ts';

// The request path makes no GitHub API call (E06-S07). The server is wired as the start-up wires it, with the Octokit
// adapter of the GitHub client port and the services built on it, over a GitHub that answers `GET /app` for the
// self-check and nothing else: MSW treats every other frame as an error. Once the server is up the transport of the
// client throws and every method of the port is watched, so a call of the request path would show up four ways: in the
// transport, at the port, at the network, and in the answer it would break.

const METHODS: readonly GitHubMethod[] = [
  'getApp',
  'getInstallation',
  'listInstallations',
  'listInstallationRepositories',
  'getRepositoryById',
  'getOrgMembership',
];

test('every row of the routing table is answered with the GitHub port wired and every call to GitHub an error: no request, no port call', async () => {
  const signing = testGitHubKey();
  const github = mockGitHub([signing.publicKey]);
  const config = testConfig({
    GITHUB_APP_ID: String(FIXTURE_IDS.app),
    GITHUB_APP_PRIVATE_KEY: signing.pem,
    GITHUB_WEBHOOK_SECRET: SECRET_CURRENT,
  });
  const logger = createLogger(config, captureLogs().destination);
  const db = await tenantDatabase();
  await createJobsTable(db);
  let armed = false;
  let attempts = 0;
  const transport: typeof fetch = (input, init) => {
    if (armed) {
      attempts += 1;
      throw new Error('the request path sent a request to GitHub');
    }
    return fetch(input, init);
  };
  const started = await startGitHubAndDatabase({ config, logger, fetch: transport, createDb: () => db });
  assert.ok(started?.github, 'the GitHub App is configured, so the start-up builds its client');
  const client = started.github.client;
  const calls = METHODS.map((method) => vi.spyOn(client, method));
  const app = await buildApp({ config, db: started.db, logger, enqueuer: fakeEnqueuer() });
  expect(github.app.tokens).toHaveLength(1);

  armed = true;
  const answered: [string, number][] = [];
  for (const [index, row] of ROUTING_ROWS.entries()) {
    const { body, headers } = deliveryOf(row, index);
    answered.push([row.label, (await postDelivery(app, body, headers)).statusCode]);
  }
  expect(answered).toEqual(ROUTING_ROWS.map((row) => [row.label, row.status]));
  expect(attempts).toBe(0);
  expect(github.app.tokens).toHaveLength(1);
  expect(github.mints).toEqual([]);
  expect(calls.map((call) => call.mock.calls)).toEqual(METHODS.map(() => []));

  // The control: the same nets do see a call when one is made, so their silence above means something.
  armed = false;
  await client.getApp();
  expect(github.app.tokens).toHaveLength(2);
  expect(calls[0]).toHaveBeenCalledOnce();
  await app.close();
});
