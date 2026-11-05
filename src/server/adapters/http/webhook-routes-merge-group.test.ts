// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import { afterAll, expect, test } from 'vitest';
import { clearRecords, deliveryRows, jobCount, sentJobs } from '../../services/jobs-fixture/test-support.ts';
import { TENANT } from '../../services/tenant-fixture/test-support.ts';
import type { Database } from '../db/schema.ts';
import {
  FIXTURE_BASE_SHA,
  FIXTURE_GROUP_OF_SEVERAL_SHA,
  FIXTURE_GROUP_SHA,
  FIXTURE_IDS,
  mergeGroupOfSeveralFixture,
  webhookFixture,
  withValue,
} from '../github/webhook-fixture/test-support.ts';
import { deliveryHeaders, postDelivery, SECRET_CURRENT, sharedTenantWebhookApp } from './test-support.ts';

// A merge group over the real route (E22-S01): `checks_requested` is recorded with its `evaluate-merge-group` job in one
// transaction and answered with nothing from GitHub, `destroyed` is recorded as finished with no job and marks the evaluation of
// that group, and any other action is a 202 `ignored`. The signature is checked before any of it.

const ENV = { GITHUB_WEBHOOK_SECRET: SECRET_CURRENT, GITHUB_APP_ID: String(FIXTURE_IDS.app) };
const ID = '5b8f2c1e-3d4a-4f6b-9a7c-0e1d2f3a4b5c';

type Running = Awaited<ReturnType<typeof sharedTenantWebhookApp>>;

let started: Promise<Running> | undefined;
afterAll(async () => {
  await (await started)?.app.close();
});

async function running(): Promise<Running> {
  started ??= sharedTenantWebhookApp(ENV);
  const server = await started;
  await clearRecords(server.db);
  await server.db.deleteFrom('merge_group_evaluations').execute();
  server.enqueuer.calls.length = 0;
  return server;
}

function deliver(app: Running['app'], body: unknown, id = ID) {
  const text = JSON.stringify(body);
  return postDelivery(
    app,
    text,
    deliveryHeaders(text, { headers: { 'x-github-event': 'merge_group', 'x-github-delivery': id } }),
  );
}

const requested = (...changes: readonly (readonly [path: string, value: unknown])[]) =>
  changes.reduce((payload, [path, value]) => withValue(payload, path, value), webhookFixture('merge_group'));

const destroyed = (...changes: readonly (readonly [path: string, value: unknown])[]) =>
  requested(['action', 'destroyed'], ...changes);

/** The evaluation row of the fixture tenant's group, stored as an earlier delivery's job would have stored it. */
async function seedGroup(db: Kysely<Database>, installationGithubId: number, repositoryGithubId: number) {
  const repository = await db
    .selectFrom('repositories as repository')
    .innerJoin('installations as installation', 'installation.id', 'repository.installation_id')
    .select(['repository.id as repositoryId', 'installation.id as installationId'])
    .where('installation.github_installation_id', '=', installationGithubId)
    .where('repository.github_repo_id', '=', repositoryGithubId)
    .executeTakeFirstOrThrow();
  await db
    .insertInto('merge_group_evaluations')
    .values({
      installation_id: repository.installationId,
      repository_id: repository.repositoryId,
      head_sha: FIXTURE_GROUP_SHA,
      base_sha: FIXTURE_BASE_SHA,
    })
    .execute();
}

const destroyedAts = async (db: Kysely<Database>) =>
  (await db.selectFrom('merge_group_evaluations').select('destroyed_at').execute()).map(
    (row) => row.destroyed_at instanceof Date,
  );

test('a checks_requested delivery is recorded once and starts one evaluate-merge-group job keyed by its delivery id', async () => {
  const { app, db } = await running();
  const response = await deliver(app, requested());
  expect(response.statusCode).toBe(202);
  expect(response.json()).toEqual({ status: 'accepted' });
  expect(await deliveryRows(db)).toMatchObject([
    { delivery_id: ID, event: 'merge_group', action: 'checks_requested', processed_at: null },
  ]);
  const jobs = await sentJobs(db);
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({
    idempotencyKey: ID,
    job: {
      type: 'evaluate-merge-group',
      deliveryId: ID,
      githubInstallationId: FIXTURE_IDS.installation,
      githubRepoId: FIXTURE_IDS.repository,
      headSha: FIXTURE_GROUP_SHA,
      baseSha: FIXTURE_BASE_SHA,
      tipPrNumber: 7,
    },
  });
  expect(await db.selectFrom('merge_group_evaluations').select('id').execute()).toEqual([]);
});

test.each([
  ['a group of one pull request', webhookFixture('merge_group'), FIXTURE_GROUP_SHA, 7],
  ['a group of several pull requests', mergeGroupOfSeveralFixture(), FIXTURE_GROUP_OF_SEVERAL_SHA, 9],
])(
  'the sanitised fixture of %s starts a job for its head SHA and the last pull request its branch names',
  async (_name, payload, headSha, tip) => {
    const { app, db } = await running();
    expect((await deliver(app, payload)).statusCode).toBe(202);
    const [job] = await sentJobs(db);
    expect(job?.job).toMatchObject({
      type: 'evaluate-merge-group',
      headSha,
      baseSha: FIXTURE_BASE_SHA,
      tipPrNumber: tip,
    });
  },
);

test('a head_ref that does not name a pull request starts the job with no tip number', async () => {
  const { app, db } = await running();
  const response = await deliver(app, requested(['merge_group.head_ref', 'refs/heads/main']));
  expect(response.json()).toEqual({ status: 'accepted' });
  const [job] = await sentJobs(db);
  expect(job?.job).toMatchObject({ type: 'evaluate-merge-group', headSha: FIXTURE_GROUP_SHA });
  expect(job?.job).not.toHaveProperty('tipPrNumber');
});

test('the same checks_requested delivery again is a 200 duplicate: still one row and one job', async () => {
  const { app, db } = await running();
  expect((await deliver(app, requested())).statusCode).toBe(202);
  const again = await deliver(app, requested());
  expect(again.statusCode).toBe(200);
  expect(again.json()).toEqual({ status: 'duplicate' });
  expect(await deliveryRows(db)).toHaveLength(1);
  expect(await jobCount(db)).toBe(1);
});

test('two deliveries for one head SHA are two records, each with a job under its own delivery id: the queue serialises them', async () => {
  const { app, db, enqueuer } = await running();
  const other = randomUUID();
  expect((await deliver(app, requested(), ID)).statusCode).toBe(202);
  expect((await deliver(app, requested(), other)).statusCode).toBe(202);
  expect(await deliveryRows(db)).toHaveLength(2);
  expect(enqueuer.calls.map((call) => call.options.idempotencyKey)).toEqual([ID, other]);
});

test('a destroyed delivery is recorded as finished, marks the evaluation of that group and starts no job', async () => {
  const { app, db, enqueuer } = await running();
  await seedGroup(db, TENANT.admitted.installation, TENANT.admitted.repository);
  const response = await deliver(app, destroyed());
  expect(response.statusCode).toBe(202);
  expect(response.json()).toEqual({ status: 'accepted' });
  const [row, ...others] = await deliveryRows(db);
  expect(others).toEqual([]);
  expect(row).toMatchObject({ delivery_id: ID, event: 'merge_group', action: 'destroyed' });
  expect(row?.processed_at).toBeInstanceOf(Date);
  expect(await destroyedAts(db)).toEqual([true]);
  expect(enqueuer.calls).toEqual([]);
  expect(await jobCount(db)).toBe(0);
});

test('a destroyed delivery of a group no job has met is recorded and finished and leaves a tombstone, so the job that runs later finds the group destroyed', async () => {
  const { app, db } = await running();
  const response = await deliver(app, destroyed());
  expect(response.statusCode).toBe(202);
  expect((await deliveryRows(db)).map((row) => row.processed_at instanceof Date)).toEqual([true]);
  expect(await db.selectFrom('merge_group_evaluations').select(['head_sha', 'base_sha']).execute()).toEqual([
    { head_sha: FIXTURE_GROUP_SHA, base_sha: FIXTURE_BASE_SHA },
  ]);
  expect(await destroyedAts(db)).toEqual([true]);
  expect(await jobCount(db)).toBe(0);
});

test('a destroyed delivery again is a 200 duplicate and starts nothing', async () => {
  const { app, db, enqueuer } = await running();
  expect((await deliver(app, destroyed())).statusCode).toBe(202);
  const again = await deliver(app, destroyed());
  expect(again.statusCode).toBe(200);
  expect(again.json()).toEqual({ status: 'duplicate' });
  expect(await deliveryRows(db)).toHaveLength(1);
  expect(enqueuer.calls).toEqual([]);
});

test('a destroyed delivery naming a repository of another tenant marks nothing of the tenant it names', async () => {
  const { app, db } = await running();
  await seedGroup(db, TENANT.admitted.installation, TENANT.admitted.repository);
  const response = await deliver(app, destroyed(['repository.id', TENANT.other.repository]));
  expect(response.json()).toEqual({ status: 'ignored', reason: 'repository_installation_mismatch' });
  expect(await destroyedAts(db)).toEqual([false]);
  expect(await jobCount(db)).toBe(1);
  expect((await sentJobs(db)).map((sent) => sent.job.type)).toEqual(['sync-installation']);
});

test.each([
  ['unknown', TENANT.unknown],
  ['rejected', TENANT.rejected],
])('a destroyed delivery of a %s installation marks nothing and starts no group job', async (_state, tenant) => {
  const { app, db } = await running();
  await seedGroup(db, TENANT.admitted.installation, TENANT.admitted.repository);
  const response = await deliver(
    app,
    destroyed(['installation.id', tenant.installation], ['repository.id', tenant.repository]),
  );
  expect(response.statusCode).toBe(202);
  expect(await destroyedAts(db)).toEqual([false]);
  expect((await sentJobs(db)).every((sent) => sent.job.type === 'sync-installation')).toBe(true);
});

test.each(['edited', 'rerequested', 'a_new_action'])(
  'a merge_group %s delivery is a 202 ignored, with no row and no job',
  async (action) => {
    const { app, db, enqueuer } = await running();
    const response = await deliver(app, requested(['action', action]));
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: 'ignored', reason: 'unsupported_action' });
    expect(await deliveryRows(db)).toEqual([]);
    expect(enqueuer.calls).toEqual([]);
  },
);

test('the signature is checked first: a wrong one is a 401 and nothing is recorded, marked or sent', async () => {
  const { app, db, enqueuer } = await running();
  await seedGroup(db, TENANT.admitted.installation, TENANT.admitted.repository);
  const text = JSON.stringify(destroyed());
  const response = await postDelivery(
    app,
    text,
    deliveryHeaders(text, {
      secret: 'wrong-webhook-secret-zzzz-0003',
      headers: { 'x-github-event': 'merge_group', 'x-github-delivery': ID },
    }),
  );
  expect(response.statusCode).toBe(401);
  expect(await deliveryRows(db)).toEqual([]);
  expect(await destroyedAts(db)).toEqual([false]);
  expect(enqueuer.calls).toEqual([]);
});

test('a payload without a head_sha is a 400 and records nothing', async () => {
  const { app, db } = await running();
  const response = await deliver(app, requested(['merge_group.head_sha', 'not-a-sha']));
  expect(response.statusCode).toBe(400);
  expect(await deliveryRows(db)).toEqual([]);
  expect(await jobCount(db)).toBe(0);
});
