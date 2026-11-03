// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { z } from 'zod';
import { OPERATOR_INSTALLATIONS_PATH, operatorInstallationsResponseSchema } from '../../../shared/operator.ts';
import { tenantChecksums } from '../db/tenant-fixture/test-support.ts';
import { authWorld } from './auth-fixture/test-support.ts';
import { operatorWorld } from './cross-tenant-runner/test-support.ts';

// `GET /api/operator/installations` (E11-S08): the rows of the operator list of E05-S07 with the state of each tenant,
// read-only, and with no personal data. Who may call it is in operator-guard.test.ts.

const LIST = { method: 'GET', url: OPERATOR_INSTALLATIONS_PATH } as const;

const AWAY_AT = '2026-10-01T00:00:00.000Z';

test('the operator gets every installation with its state, the times in UTC and the repository counts', async () => {
  const world = await operatorWorld();
  const response = await world.ask('outsider', LIST);
  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toContain('application/json');
  expect(operatorInstallationsResponseSchema.parse(response.json())).toEqual(response.json());
  expect(response.json()).toEqual({
    installations: [
      {
        githubInstallationId: 5000,
        accountId: 7000,
        accountLogin: 'org-1',
        accountType: 'Organization',
        admissionStatus: 'admitted',
        admissionReason: null,
        admissionDecidedAt: '2026-05-01T10:00:00.000Z',
        suspendedAt: null,
        deletedAt: null,
        tenantState: 'active',
        repositories: { active: 2, enabled: 1, removed: 0 },
      },
      {
        githubInstallationId: 10_000,
        accountId: 14_000,
        accountLogin: 'org-2',
        accountType: 'Organization',
        admissionStatus: 'admitted',
        admissionReason: null,
        admissionDecidedAt: '2026-05-01T10:00:00.000Z',
        suspendedAt: null,
        deletedAt: null,
        tenantState: 'active',
        repositories: { active: 2, enabled: 1, removed: 0 },
      },
    ],
  });
});

test('the answer is told not to be cached: it lists every organisation the instance serves', async () => {
  const world = await operatorWorld();
  expect((await world.ask('outsider', LIST)).headers['cache-control']).toBe('no-store');
});

test('an instance that knows no installation answers an empty list', async () => {
  const { app, login } = await authWorld({ OPERATOR_GITHUB_IDS: '1001' });
  const operator = await login(1001);
  const response = await app.inject({ url: OPERATOR_INSTALLATIONS_PATH, headers: { cookie: operator.cookie } });
  expect([response.statusCode, response.json()]).toEqual([200, { installations: [] }]);
});

const NOW_AWAY = new Date(AWAY_AT);

test.each([
  ['rejected', { admission_status: 'rejected', admission_reason: 'policy_changed' }, 'rejected'],
  ['deleted', { deleted_at: NOW_AWAY }, 'deleted'],
  ['suspended', { suspended_at: NOW_AWAY }, 'suspended'],
  ['uninstalled while suspended', { suspended_at: NOW_AWAY, deleted_at: NOW_AWAY }, 'deleted'],
  [
    'rejected and uninstalled',
    { admission_status: 'rejected', admission_reason: 'account_not_allowed', deleted_at: NOW_AWAY },
    'rejected',
  ],
] as const)(
  'a tenant that is %s is listed with the state %s, and the other tenant stays active',
  async (_label, columns, state) => {
    const world = await operatorWorld();
    await world.db.updateTable('installations').set(columns).where('id', '=', world.t1.installationId).execute();
    const { installations } = operatorInstallationsResponseSchema.parse((await world.ask('outsider', LIST)).json());
    expect(installations.map((installation) => installation.tenantState)).toEqual([state, 'active']);
    const [first] = installations;
    expect(first).toMatchObject({
      admissionStatus: 'admission_status' in columns ? columns.admission_status : 'admitted',
      admissionReason: 'admission_reason' in columns ? columns.admission_reason : null,
      suspendedAt: 'suspended_at' in columns ? AWAY_AT : null,
      deletedAt: 'deleted_at' in columns ? AWAY_AT : null,
    });
  },
);

test('removed repositories are counted apart from the active ones', async () => {
  const world = await operatorWorld();
  await world.db
    .updateTable('repositories')
    .set({ removed_at: NOW_AWAY })
    .where('id', '=', world.t1.scoped.repositoryId)
    .execute();
  await world.db
    .updateTable('repositories')
    .set({ enabled: true })
    .where('id', '=', world.t1.plain.repositoryId)
    .execute();
  const { installations } = operatorInstallationsResponseSchema.parse((await world.ask('outsider', LIST)).json());
  expect(installations[0]?.repositories).toEqual({ active: 1, enabled: 1, removed: 1 });
});

const INSTALLATION_KEYS = [
  'accountId',
  'accountLogin',
  'accountType',
  'admissionDecidedAt',
  'admissionReason',
  'admissionStatus',
  'deletedAt',
  'githubInstallationId',
  'repositories',
  'suspendedAt',
  'tenantState',
];

test('an installation carries these fields and no others: ids, display snapshots of the account, times and counts', async () => {
  const world = await operatorWorld();
  const body = z
    .object({ installations: z.array(z.record(z.string(), z.unknown())) })
    .parse((await world.ask('outsider', LIST)).json());
  expect(
    body.installations.map((installation) => Object.keys(installation).toSorted((a, b) => a.localeCompare(b))),
  ).toEqual([INSTALLATION_KEYS, INSTALLATION_KEYS]);
});

test('the answer names no person: not a login, a name, an email or an avatar of any user, signer or publisher', async () => {
  const world = await operatorWorld();
  const users = await world.db.selectFrom('users').select(['login', 'name', 'avatar_url']).execute();
  const signers = await world.db.selectFrom('signer_pii').select(['login', 'name', 'email']).execute();
  const personal = [...users, ...signers].flatMap((row) => Object.values(row)).filter((value) => value !== null);
  expect(personal.length).toBeGreaterThan(10);
  const { body } = await world.ask('outsider', LIST);
  expect(personal.filter((text) => body.includes(text))).toEqual([]);
  expect(body).not.toMatch(/signature|signer|email|avatar/i);
});

test('the route only reads: it is the one operator route, answers GET, and no state-changing request reaches it', async () => {
  const world = await operatorWorld();
  await world.app.ready();
  expect(
    world.app.routeAccess.filter((entry) => entry.access === 'operator').map((entry) => `${entry.method} ${entry.url}`),
  ).toEqual(['GET /api/operator/installations']);
  const before = await tenantChecksums(world.db);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
    const response = await world.ask('outsider', { method, url: OPERATOR_INSTALLATIONS_PATH, payload: {} });
    expect([method, response.statusCode]).toEqual([method, 404]);
  }
  expect(await tenantChecksums(world.db)).toEqual(before);
});

test('listing the installations changes no row', async () => {
  const world = await operatorWorld();
  const before = await tenantChecksums(world.db);
  await world.ask('outsider', LIST);
  expect(await tenantChecksums(world.db)).toEqual(before);
});
