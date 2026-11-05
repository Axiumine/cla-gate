// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { afterAll, expect, test } from 'vitest';
import { buildApp } from '../../app.ts';
import { createJobsTable, fakeEnqueuer } from '../../services/jobs-fixture/test-support.ts';
import { createTenantFilter } from '../../services/tenant-filter.ts';
import {
  countingDatabase,
  TENANT,
  tenantDatabase,
  UNSTORED_REPOSITORY,
} from '../../services/tenant-fixture/test-support.ts';
import { FakeClock } from '../../services/test-support.ts';
import { captureLogs, testConfig } from '../../test-support.ts';
import type { Database } from '../db/schema.ts';
import { FIXTURE_IDS, type WebhookEvent, webhookFixture, withValue } from '../github/webhook-fixture/test-support.ts';
import { webhookDeliverySchema } from '../github/webhook-schemas.ts';
import { createLogger } from './logger.ts';
import { deliveryHeaders, envelopeOf, postDelivery, SECRET_CURRENT } from './test-support.ts';
import { routeDelivery } from './webhook-answer.ts';

// The tenant and admission filter (E06-S05) over the real route: what a signed delivery of each event is answered with
// when the installation it names is admitted, rejected, suspended, deleted, unknown, or holds a repository that is stored
// under another. One app, one database and one statement counter serve the file. A delivery that starts a job is recorded
// and its job sent (E06-S06), so every delivery here has an id of its own and the statement counts include the insert
// of the delivery and the send of the job.

const ENV = { GITHUB_WEBHOOK_SECRET: SECRET_CURRENT, GITHUB_APP_ID: String(FIXTURE_IDS.app) };

interface Running {
  readonly app: FastifyInstance;
  /** The database handle the app reads through. */
  readonly db: Kysely<Database>;
  readonly statements: string[];
}

let started: Promise<Running> | undefined;
afterAll(async () => {
  await (await started)?.app.close();
});

async function start(): Promise<Running> {
  const config = testConfig(ENV);
  const counted = countingDatabase(await tenantDatabase());
  await createJobsTable(counted.db);
  const app = await buildApp({
    config,
    db: counted.db,
    logger: createLogger(config, captureLogs().destination),
    enqueuer: fakeEnqueuer(),
  });
  return { app, db: counted.db, statements: counted.statements };
}

/** The app of the file, and the statements it has sent since the last call. */
async function server(): Promise<Running> {
  started ??= start();
  const running = await started;
  running.statements.length = 0;
  return running;
}

function deliver(app: FastifyInstance, event: string, body: unknown) {
  const text = JSON.stringify(body);
  const headers = { 'x-github-event': event, 'x-github-delivery': randomUUID() };
  return postDelivery(app, text, deliveryHeaders(text, { headers }));
}

/** The fixture of `event` as it would be sent for the installation and the repository with these ids. */
function payloadFor(event: WebhookEvent, ids: { readonly installation: number; readonly repository: number }) {
  return withValue(
    withValue(webhookFixture(event), 'installation.id', ids.installation),
    'repository.id',
    ids.repository,
  );
}

const ACCEPTED = { statusCode: 202, body: { status: 'accepted' } };
const ignored = (reason: string) => ({ statusCode: 202, body: { status: 'ignored', reason } });

const STATES = [
  // The two reads of the filter, the insert of the delivery and the send of its job.
  { tenant: 'admitted', ids: TENANT.admitted, ...ACCEPTED, statements: 4 },
  {
    tenant: 'admitted, repository not stored yet',
    ids: { ...TENANT.admitted, repository: UNSTORED_REPOSITORY },
    ...ACCEPTED,
    statements: 4,
  },
  { tenant: 'rejected', ids: TENANT.rejected, ...ignored('installation_not_admitted'), statements: 1 },
  { tenant: 'suspended', ids: TENANT.suspended, ...ignored('installation_suspended'), statements: 1 },
  { tenant: 'deleted', ids: TENANT.deleted, ...ignored('installation_deleted'), statements: 1 },
  // The sync that replaces the delivery is recorded and sent: the read of the installation, the insert and the send.
  { tenant: 'unknown', ids: TENANT.unknown, ...ignored('installation_unknown'), statements: 3 },
  {
    tenant: 'A with a repository stored under B',
    ids: { installation: TENANT.admitted.installation, repository: TENANT.other.repository },
    ...ignored('repository_installation_mismatch'),
    statements: 4,
  },
  {
    tenant: 'B with a repository stored under A',
    ids: { installation: TENANT.other.installation, repository: TENANT.admitted.repository },
    ...ignored('repository_installation_mismatch'),
    statements: 4,
  },
] as const;

const TENANT_EVENTS: readonly WebhookEvent[] = [
  'pull_request',
  'check_run',
  'check_suite',
  'issue_comment',
  'merge_group',
];

const ROWS = TENANT_EVENTS.flatMap((event) => STATES.map((state) => ({ event, ...state })));

test.each(ROWS)('$event of $tenant is answered $statusCode', async ({ event, ids, statusCode, body, statements }) => {
  const { app, statements: sent } = await server();
  const response = await deliver(app, event, payloadFor(event, ids));
  expect(response.statusCode).toBe(statusCode);
  expect(response.json()).toEqual(body);
  expect(sent).toHaveLength(statements);
});

const LIFECYCLE: readonly (readonly [WebhookEvent, string])[] = [
  ['installation', 'created'],
  ['installation', 'deleted'],
  ['installation', 'suspend'],
  ['installation', 'unsuspend'],
  ['installation', 'new_permissions_accepted'],
  ['installation_repositories', 'added'],
  ['installation_repositories', 'removed'],
];

test.each(LIFECYCLE)(
  'the lifecycle event %s %s of a rejected account is not filtered: it is recorded and sent as a sync, and reads nothing',
  async (event, action) => {
    const { app, statements } = await server();
    const payload = withValue(
      withValue(webhookFixture(event), 'action', action),
      'installation.id',
      TENANT.rejected.installation,
    );
    const response = await deliver(app, event, payload);
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: 'accepted' });
    expect(statements).toEqual(['InsertQueryNode', 'RawNode']);
  },
);

test.each(LIFECYCLE)(
  'the lifecycle event %s %s of a rejected account is routed to a sync-installation job that the filter passes on as it is',
  async (event, action) => {
    const { db, statements } = await server();
    const payload = withValue(
      withValue(webhookFixture(event), 'action', action),
      'installation.id',
      TENANT.rejected.installation,
    );
    const envelope = envelopeOf(event, JSON.stringify(payload));
    const routing = routeDelivery(
      envelope,
      webhookDeliverySchema.parse({ event, payload: envelope.payload }),
      undefined,
    );
    expect(routing).toMatchObject({
      kind: 'job',
      job: { type: 'sync-installation', githubInstallationId: TENANT.rejected.installation },
    });
    const filter = createTenantFilter({ db, clock: new FakeClock('2026-06-01T12:00:00Z') });
    expect(await filter.admit(routing, { warn: () => undefined })).toBe(routing);
    expect(statements).toEqual([]);
  },
);

test('an authorisation revoked names no installation, so it is not filtered', async () => {
  const { app, statements } = await server();
  const response = await deliver(app, 'github_app_authorization', webhookFixture('github_app_authorization'));
  expect(response.json()).toEqual({ status: 'accepted' });
  expect(statements).toEqual(['InsertQueryNode', 'RawNode']);
});

test('a ping, an unsubscribed event and an ignored action are answered without a read', async () => {
  const { app, statements } = await server();
  const labeled = withValue(webhookFixture('pull_request'), 'action', 'labeled');
  expect((await deliver(app, 'ping', { zen: 'x' })).statusCode).toBe(200);
  expect((await deliver(app, 'push', { ref: 'x' })).statusCode).toBe(202);
  expect((await deliver(app, 'pull_request', labeled)).statusCode).toBe(202);
  expect(statements).toEqual([]);
});

test('the answer to a turned-away delivery holds constants of the server only: nothing of the tenant or of the payload', async () => {
  const { app } = await server();
  const payload = withValue(payloadFor('pull_request', TENANT.rejected), 'pull_request.title', 'canary-title-8e1f5b2a');
  const response = await deliver(app, 'pull_request', payload);
  expect(response.json()).toEqual({ status: 'ignored', reason: 'installation_not_admitted' });
  for (const text of [
    'canary',
    'account-',
    'fixture-',
    String(TENANT.rejected.installation),
    String(TENANT.rejected.repository),
  ]) {
    expect(response.body).not.toContain(text);
  }
});
