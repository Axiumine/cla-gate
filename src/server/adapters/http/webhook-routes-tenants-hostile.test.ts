// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import {
  countingDatabase,
  TENANT,
  tenantDatabase,
  UNSTORED_REPOSITORY,
} from '../../services/tenant-fixture/test-support.ts';
import { FakeClock } from '../../services/test-support.ts';
import { testApp } from '../../test-support.ts';
import {
  ABSENT,
  FIXTURE_IDS,
  type WebhookEvent,
  webhookFixture,
  withRawJson,
  withValue,
} from '../github/webhook-fixture/test-support.ts';
import { deliveryHeaders, postDelivery, SECRET_CURRENT, webhookTestApp } from './test-support.ts';

// The tenant and admission filter against hostile ids and a failing database (E06-S05): what a payload can say about the
// installation and the repository must be a GitHub id before the database is asked anything, and a database that fails
// fails the delivery, never lets it through.

const ENV = { GITHUB_WEBHOOK_SECRET: SECRET_CURRENT, GITHUB_APP_ID: String(FIXTURE_IDS.app) };
const CANARY = 'canary-value-8e1f5b2a';
const MINUTE = 60_000;

/** The app over the tenants, with the statements it sends counted. */
async function countedApp(options: { readonly clock?: FakeClock } = {}) {
  const counted = countingDatabase(await tenantDatabase());
  const running = await testApp({ env: ENV, db: counted.db, ...options });
  return { ...running, statements: counted.statements };
}

function deliver(app: Awaited<ReturnType<typeof testApp>>['app'], event: string, body: string | object) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return postDelivery(app, text, deliveryHeaders(text, { headers: { 'x-github-event': event } }));
}

const TENANT_EVENTS: readonly WebhookEvent[] = ['pull_request', 'check_run', 'check_suite', 'issue_comment'];

const HOSTILE_IDS: readonly (readonly [label: string, raw: string])[] = [
  ['a string that closes a quote and adds a clause', "\"31001' OR '1'='1\""],
  ['a string that is a number', '"31001"'],
  ['a 20-digit numeric string', '"31001000000000000000"'],
  ['a float', '31001.5'],
  ['a negative number', '-31001'],
  ['zero', '0'],
  ['2**53', '9007199254740992'],
  ['1e400', '1e400'],
  ['null', 'null'],
  ['an array of ids', '[31001, 31002]'],
  ['an object', '{"$gt":0}'],
  ['true', 'true'],
];

const HOSTILE_PATHS = ['installation.id', 'repository.id'] as const;

const HOSTILE_ROWS = HOSTILE_PATHS.flatMap((path) => HOSTILE_IDS.map(([label, raw]) => ({ path, label, raw })));

// These rows run on an app whose database refuses every connection: a 400 proves the payload was refused before the
// database was asked anything, because a read would have failed the delivery with a 500.
test.each(HOSTILE_ROWS)('$label as $path is a 400 and the database is not asked anything', async ({ path, raw }) => {
  const { app } = await webhookTestApp({ env: ENV });
  const body = withRawJson(webhookFixture('pull_request'), path, raw);
  const response = await deliver(app, 'pull_request', body);
  expect(response.statusCode).toBe(400);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('webhook_payload_invalid');
});

test.each(['installation', 'repository'] as const)(
  'a pull request without its %s is a 400 and reads nothing',
  async (key) => {
    const { app } = await webhookTestApp({ env: ENV });
    const response = await deliver(app, 'pull_request', withValue(webhookFixture('pull_request'), key, ABSENT));
    expect(response.statusCode).toBe(400);
  },
);

test('the largest GitHub id names no tenant, in any event: the delivery is replaced by a sync, not failed', async () => {
  const { app } = await countedApp();
  for (const event of TENANT_EVENTS) {
    const payload = withValue(
      withValue(webhookFixture(event), 'installation.id', Number.MAX_SAFE_INTEGER),
      'repository.id',
      Number.MAX_SAFE_INTEGER,
    );
    const response = await deliver(app, event, payload);
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: 'ignored', reason: 'installation_unknown' });
  }
});

test('a rejected installation that names the repository of an admitted tenant gets nothing of that tenant', async () => {
  const { app, statements } = await countedApp();
  const stolen = withValue(
    withValue(webhookFixture('pull_request'), 'installation.id', TENANT.rejected.installation),
    'repository.id',
    TENANT.admitted.repository,
  );
  const response = await deliver(app, 'pull_request', stolen);
  expect(response.json()).toEqual({ status: 'ignored', reason: 'installation_not_admitted' });
  expect(statements).toEqual(['SelectQueryNode']);
});

test('ids smuggled in through __proto__ and constructor keys name no tenant', async () => {
  const { app } = await countedApp();
  const base = JSON.stringify(
    withValue(webhookFixture('pull_request'), 'installation.id', TENANT.rejected.installation),
  );
  const body = base.replace(
    '"installation":{',
    `"__proto__":{"id":${TENANT.admitted.installation}},"installation":{"__proto__":{"id":${TENANT.admitted.installation}},"constructor":{"id":${TENANT.admitted.installation}},`,
  );
  const response = await deliver(app, 'pull_request', body);
  expect(response.json()).toEqual({ status: 'ignored', reason: 'installation_not_admitted' });
});

test('a repeated installation key: the last one decides, as JSON.parse reads it', async () => {
  const { app } = await countedApp();
  const without = withValue(webhookFixture('pull_request'), 'installation', ABSENT);
  const tail = `"installation":{"id":${TENANT.admitted.installation}},"installation":{"id":${TENANT.rejected.installation}}`;
  const body = `${JSON.stringify(without).slice(0, -1)},${tail}}`;
  const response = await deliver(app, 'pull_request', body);
  expect(response.json()).toEqual({ status: 'ignored', reason: 'installation_not_admitted' });
});

test('text in the payload that looks like a tenant changes nothing: only the ids are read', async () => {
  const { app } = await countedApp();
  const payload = withValue(
    withValue(
      webhookFixture('pull_request'),
      'pull_request.title',
      `${TENANT.admitted.installation} installation_not_admitted`,
    ),
    'repository.full_name',
    `account-${TENANT.rejected.installation}/repo`,
  );
  const response = await deliver(
    app,
    'pull_request',
    withValue(payload, 'installation.id', TENANT.rejected.installation),
  );
  expect(response.json()).toEqual({ status: 'ignored', reason: 'installation_not_admitted' });
});

test('a signature that does not verify is a 401 before the tenant is looked up', async () => {
  const { app } = await webhookTestApp({ env: ENV });
  const text = JSON.stringify(webhookFixture('pull_request'));
  const response = await postDelivery(
    app,
    text,
    deliveryHeaders(text, { signature: `sha256=${'0'.repeat(64)}`, headers: { 'x-github-event': 'pull_request' } }),
  );
  expect(response.statusCode).toBe(401);
});

test('a database that fails fails the delivery with a 500 and a log without the payload, and admits nothing', async () => {
  const { app, logs } = await webhookTestApp({ env: ENV });
  const payload = withValue(webhookFixture('pull_request'), 'pull_request.title', CANARY);
  const response = await deliver(app, 'pull_request', payload);
  expect(response.statusCode).toBe(500);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('internal_server_error');
  expect(response.body).not.toContain(CANARY);
  expect(logs.text()).not.toContain(CANARY);
  expect(logs.text()).not.toContain('fixture-');
});

test('a rejected tenant is logged once a minute with numeric ids, and the log holds nothing of the payload', async () => {
  const clock = new FakeClock('2026-06-01T12:00:00Z');
  const { app, logs } = await countedApp({ clock });
  const payload = withValue(
    withValue(
      withValue(webhookFixture('pull_request'), 'installation.id', TENANT.rejected.installation),
      'repository.id',
      TENANT.rejected.repository,
    ),
    'pull_request.title',
    CANARY,
  );
  for (let delivery = 0; delivery < 5; delivery += 1) {
    await deliver(app, 'pull_request', payload);
  }
  const refused = () => logs.lines().filter((line) => line['msg'] === 'webhook.tenant_refused');
  expect(refused()).toHaveLength(1);
  expect(refused()[0]).toMatchObject({
    level: 40,
    githubInstallationId: TENANT.rejected.installation,
    githubRepoId: TENANT.rejected.repository,
    reason: 'installation_not_admitted',
  });
  clock.advance(MINUTE);
  await deliver(app, 'pull_request', payload);
  expect(refused()).toHaveLength(2);
  for (const text of [CANARY, 'fixture-', 'account-', 'Fixture:', SECRET_CURRENT]) {
    expect(logs.text()).not.toContain(text);
  }
});

test('the request path sends no request to GitHub, whatever the tenant', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  const { app } = await countedApp();
  for (const ids of [
    TENANT.admitted,
    TENANT.rejected,
    TENANT.suspended,
    TENANT.deleted,
    TENANT.unknown,
    { ...TENANT.admitted, repository: UNSTORED_REPOSITORY },
    { installation: TENANT.admitted.installation, repository: TENANT.other.repository },
  ]) {
    const payload = withValue(
      withValue(webhookFixture('pull_request'), 'installation.id', ids.installation),
      'repository.id',
      ids.repository,
    );
    await deliver(app, 'pull_request', payload);
  }
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});
