// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { EventEmitter } from 'node:events';
import { expect, onTestFinished, test, vi } from 'vitest';
import { openPgliteDatabase } from './adapters/db/pglite.ts';
import { mockApp } from './adapters/github/test-support.ts';
import { type BootOptions, boot } from './boot.ts';
import { evaluationWiring } from './boot-evaluation.ts';
import { AUTH_ENV } from './config/auth-fixture/test-support.ts';
import { TEST_WEBHOOK_SECRET, testGitHubKey } from './config/test-support.ts';
import { CheckRunReporter } from './services/reporting/check-run-reporter.ts';
import { FAILING, PASSING, reportingWorld } from './services/reporting/test-support.ts';
import { captureLogs, freePort, startFakeJobQueue, testConfig, UNREACHABLE_DATABASE_URL } from './test-support.ts';

// What boot binds for the evaluation jobs (E09-S06): the Check Run reporter on the GitHub client of the App, built with the
// App id and the public origin of the configuration; nothing at all when there is no App.

const APP_ENV = { GITHUB_APP_ID: '4242', PUBLIC_BASE_URL: 'https://cla.example.org' };
const NO_NAMES = { logins: new Map<number, string>(), coAuthors: new Map<string, string[]>() };

test('the reporter is built on the client and the database it is given, and reports as the App of the configuration', async () => {
  const world = await reportingWorld();
  const wiring = evaluationWiring({
    config: testConfig(APP_ENV),
    logger: world.logger,
    db: world.db,
    github: world.fake,
    clock: world.clock,
  });
  expect(wiring?.github).toBe(world.fake);
  expect(wiring?.reporter).toBeInstanceOf(CheckRunReporter);
  const target = await world.evaluation();
  await wiring?.reporter.started(target);
  await wiring?.reporter.publish(target, FAILING, NO_NAMES);
  // One run: the run `started` posted is the run of the App 4242, so `publish` found it again and completed it.
  expect(world.fake.checkRuns).toHaveLength(1);
  expect(world.fake.checkRuns[0]?.run).toMatchObject({ status: 'completed', appId: 4242 });
  expect(world.fake.checkRuns[0]?.write?.detailsUrl).toBe('https://cla.example.org/sign/9000?pr=7');
});

test('a reporter of another App id does not recognise the run of the App 4242 and posts a run of its own', async () => {
  const world = await reportingWorld();
  const wiring = evaluationWiring({
    config: testConfig({ ...APP_ENV, GITHUB_APP_ID: '77' }),
    logger: world.logger,
    db: world.db,
    github: world.fake,
    clock: undefined,
  });
  const target = await world.evaluation();
  await wiring?.reporter.started(target);
  await wiring?.reporter.publish(target, PASSING, NO_NAMES);
  expect(world.fake.checkRuns.map((stored) => stored.run.status)).toEqual(['in_progress', 'completed']);
});

test.each([
  ['no client', { GITHUB_APP_ID: '4242' }, false],
  ['an App id that is no number GitHub could give', { GITHUB_APP_ID: '9'.repeat(20) }, true],
  ['no App id', {}, true],
])('with %s there is no evaluation wiring: the jobs that need it fail and retry', async (_name, env, hasClient) => {
  const world = await reportingWorld();
  expect(
    evaluationWiring({
      config: testConfig(env),
      logger: world.logger,
      db: world.db,
      github: hasClient ? world.fake : undefined,
      clock: undefined,
    }),
  ).toBeUndefined();
});

class FakeProcess extends EventEmitter {
  exitCode: number | string | null | undefined;
}

/** Boots on PGlite, with the signing key GitHub accepts when one is given, and returns what the queue was started with. */
async function bootWith(env: Record<string, string>, signer?: ReturnType<typeof testGitHubKey>) {
  const db = await openPgliteDatabase();
  const createJobQueue = vi.fn<NonNullable<BootOptions['createJobQueue']>>(startFakeJobQueue);
  if (signer !== undefined) {
    mockApp([signer.publicKey]);
  }
  const server = await boot({
    env: {
      DATABASE_URL: UNREACHABLE_DATABASE_URL,
      HOST: '127.0.0.1',
      PORT: String(await freePort()),
      LOG_LEVEL: 'info',
      ...AUTH_ENV,
      NODE_ENV: 'production',
      PUBLIC_BASE_URL: 'https://cla.example.test',
      GITHUB_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
      ...env,
    },
    signals: new FakeProcess(),
    createDb: () => db,
    createJobQueue,
    logDestination: captureLogs().destination,
    reconcileOnStart: false,
  });
  onTestFinished(async () => {
    await server?.close();
    await db.destroy();
  });
  return { server, workers: createJobQueue.mock.calls[0]?.[2] };
}

test('a server with a GitHub App starts its queue with the evaluation ports and the sweep schedule', async () => {
  const signer = testGitHubKey();
  const { server, workers } = await bootWith({ GITHUB_APP_ID: '4242', GITHUB_APP_PRIVATE_KEY: signer.pem }, signer);
  expect(server).toBeDefined();
  expect(workers?.deadLetter?.evaluation).toBeTypeOf('function');
  expect(workers?.sweepIntervalMinutes).toBeGreaterThan(0);
});

test('a server without a GitHub App starts its queue without them', async () => {
  const { server, workers } = await bootWith({ NODE_ENV: 'development', PUBLIC_BASE_URL: 'http://127.0.0.1:3000' });
  expect(server).toBeDefined();
  expect(workers?.deadLetter?.evaluation).toBeUndefined();
  expect(workers?.sweepIntervalMinutes).toBe(0);
});
