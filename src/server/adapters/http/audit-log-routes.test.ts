// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { AUDIT_LOG_PATH, auditLogPageSchema } from '../../../shared/audit-log.ts';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { insertAuditRows } from '../../services/audit-log-fixture/test-support.ts';
import { type PersonName, tenantChecksums } from '../db/tenant-fixture/test-support.ts';
import { matrixWorld } from './cross-tenant-runner/test-support.ts';
import { shapeOf } from './tenant-guard-fixture/test-support.ts';

// `GET /api/installations/:installationId/audit-log` (E16-S02): who may read it, what the query string may carry, what a
// page looks like. The data function is in services/audit-log-queries.test.ts, the cross-tenant matrix in
// cross-tenant-matrix.test.ts, the query plan in audit-log-plan.test.ts.

const pathOf = (installationId: number): string => AUDIT_LOG_PATH.replace(':installationId', String(installationId));

/** Newer than any row a fixture stores with the time of the insert. */
const NEWEST = '2999-01-01T00:00:00.000Z';

const errorCode = (body: unknown): string => errorResponseSchema.parse(body).error.code;

/** The world of the matrix (two tenants, five people, one seeded audit row each) and a call of the audit log as one of them. */
async function world() {
  const state = await matrixWorld();
  const read = (who: PersonName | null, installationId: number, query = '') =>
    state.ask(who, { method: 'GET', url: `${pathOf(installationId)}${query}` });
  const pageOf = async (who: PersonName, installationId: number, query = '') =>
    auditLogPageSchema.parse((await read(who, installationId, query)).json());
  /** The ids of the page, newest first. */
  const idsOf = async (who: PersonName, installationId: number, query = '') =>
    (await pageOf(who, installationId, query)).items.map((item) => item.id);
  /** Every audit row of the tenant in the database, in the order of the listing: the oracle the answers are held to. */
  const stored = async (installationId: number): Promise<number[]> => {
    const rows = await state.db
      .selectFrom('audit_log')
      .select('id')
      .where('installation_id', '=', installationId)
      .orderBy('occurred_at', 'desc')
      .orderBy('id', 'desc')
      .execute();
    return rows.map((row) => row.id);
  };
  return { ...state, read, pageOf, idsOf, stored };
}

test('an org admin reads the audit trail of their tenant: the seeded row, with the login read from the users snapshot', async () => {
  const { read, t1 } = await world();
  const response = await read('admin1', t1.installationId);
  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toContain('application/json');
  expect(response.headers['cache-control']).toBe('no-store');
  const page = auditLogPageSchema.parse(response.json());
  expect(page.nextCursor).toBeNull();
  const [item, ...rest] = page.items;
  expect(rest).toEqual([]);
  expect(Number.isInteger(item?.id)).toBe(true);
  expect(item?.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(item).toMatchObject({
    action: 'repository.enabled',
    actor: { githubId: 1001, login: 'publisher-1' },
    subject: { type: 'repository', id: t1.repositoryId },
    metadata: { repository_id: t1.repositoryId },
  });
});

test.each([
  ['admin1', 200, null],
  ['repoAdmin1', 403, 'forbidden'],
  ['member1', 404, 'not_found'],
  ['outsider', 404, 'not_found'],
  ['admin2', 404, 'not_found'],
] as const)('%s asks for the audit trail of tenant 1 and gets %i %s', async (who, status, code) => {
  const { read, t1 } = await world();
  const response = await read(who, t1.installationId);
  expect([response.statusCode, code === null ? null : errorCode(response.json())]).toEqual([status, code]);
});

test('the audit trail of a User installation is read by the owner of the account and nobody else', async () => {
  const { app, db, login, read, t1 } = await world();
  const owner = await login(7000);
  await db.updateTable('installations').set({ account_type: 'User' }).where('id', '=', t1.installationId).execute();
  const asOwner = await app.inject({ url: pathOf(t1.installationId), headers: { cookie: owner.cookie } });
  expect(asOwner.statusCode).toBe(200);
  expect(auditLogPageSchema.parse(asOwner.json()).items).toHaveLength(1);
  expect([
    (await read('admin1', t1.installationId)).statusCode,
    (await read('outsider', t1.installationId)).statusCode,
  ]).toEqual([404, 404]);
});

test('a request with no session is a 401, and the answer to a viewer with no role is the one for an installation that does not exist', async () => {
  const { read, t1 } = await world();
  expect((await read(null, t1.installationId)).statusCode).toBe(401);
  const unknown = shapeOf(await read('admin1', 987_654));
  expect(unknown.status).toBe(404);
  for (const who of ['member1', 'outsider', 'admin2'] as const) {
    expect(shapeOf(await read(who, t1.installationId))).toEqual(unknown);
  }
});

test.each(['abc', '0', '-1', '01', '1.5'])('the path /api/installations/%s/audit-log is a 400', async (id) => {
  const { ask } = await world();
  const response = await ask('admin1', { method: 'GET', url: `/api/installations/${id}/audit-log` });
  expect(response.statusCode).toBe(400);
});

test.each([
  ['an action that is not in the catalogue', 'action=signature.deleted'],
  ['an empty action', 'action='],
  ['an actor id of zero', 'actorGithubId=0'],
  ['an actor id that is a login', 'actorGithubId=octocat'],
  ['a subject id with a fraction', 'subjectId=1.5'],
  ['a subject type in the wrong case', 'subjectType=Repository'],
  ['from with no offset', 'from=2026-11-01T00:00:00'],
  ['to that is not an instant', 'to=yesterday'],
  ['a limit of zero', 'limit=0'],
  ['a limit of 201', 'limit=201'],
  ['a limit that is text', 'limit=all'],
  ['a cursor that is not ours', 'cursor=AAAA'],
  ['a repeated parameter', 'limit=10&limit=20'],
  ['a parameter nobody defined', 'installationId=2'],
])('%s is a 400 bad_request', async (_name, query) => {
  const { read, t1 } = await world();
  const response = await read('admin1', t1.installationId, `?${query}`);
  expect([response.statusCode, errorCode(response.json())]).toEqual([400, 'bad_request']);
});

test('a limit of 1 and a limit of 200 are accepted, and the default page holds 50 rows with a cursor to the rest', async () => {
  const { db, pageOf, stored, t1 } = await world();
  await insertAuditRows(
    db,
    Array.from({ length: 60 }, (_, index) => ({
      occurredAt: new Date(Date.parse('2026-11-02T10:00:00Z') + index * 1000).toISOString(),
      installationId: t1.installationId,
    })),
  );
  const expected = await stored(t1.installationId);
  expect(expected).toHaveLength(61);
  const standard = await pageOf('admin1', t1.installationId);
  expect(standard.items.map((item) => item.id)).toEqual(expected.slice(0, 50));
  expect(standard.nextCursor).not.toBeNull();
  const one = await pageOf('admin1', t1.installationId, '?limit=1');
  expect(one.items.map((item) => item.id)).toEqual(expected.slice(0, 1));
  const all = await pageOf('admin1', t1.installationId, '?limit=200');
  expect(all.items.map((item) => item.id)).toEqual(expected);
  expect(all.nextCursor).toBeNull();
});

test('250 rows that share one instant are walked with the cursors of the answers: no row twice, none missing', async () => {
  const { db, pageOf, stored, t1, t2 } = await world();
  const same = '2026-11-02T10:00:00.000Z';
  const rows = Array.from({ length: 250 }, () => ({ occurredAt: same, installationId: t1.installationId }));
  await insertAuditRows(db, [...rows, { occurredAt: same, installationId: t2.installationId }]);
  const seen: number[] = [];
  let query = '?limit=100';
  for (let pages = 0; pages < 5; pages += 1) {
    const page = await pageOf('admin1', t1.installationId, query);
    seen.push(...page.items.map((item) => item.id));
    if (page.nextCursor === null) {
      break;
    }
    query = `?limit=100&cursor=${page.nextCursor}`;
  }
  expect(seen).toEqual(await stored(t1.installationId));
  expect(seen).toHaveLength(251);
  expect(new Set(seen).size).toBe(251);
});

test('a cursor that was cut short, extended or spelled in another alphabet is a 400', async () => {
  const { db, read, pageOf, t1 } = await world();
  const rows = Array.from({ length: 3 }, () => ({ occurredAt: NEWEST, installationId: t1.installationId }));
  await insertAuditRows(db, rows);
  const cursor = (await pageOf('admin1', t1.installationId, '?limit=1')).nextCursor ?? '';
  expect(cursor).not.toBe('');
  for (const tampered of [cursor.slice(0, -4), `${cursor}AAAA`, `${cursor}==`, cursor.replace(/[A-Za-z]/, '+'), '']) {
    const response = await read('admin1', t1.installationId, `?cursor=${encodeURIComponent(tampered)}`);
    expect([tampered, response.statusCode]).toEqual([tampered, 400]);
  }
  expect((await read('admin1', t1.installationId, `?cursor=${cursor}`)).statusCode).toBe(200);
});

test('the filters narrow the page, the instants are read with their offset, and from is inclusive while to is exclusive', async () => {
  const { db, idsOf, t1 } = await world();
  const row = (occurredAt: string, rest: object) => ({ occurredAt, installationId: t1.installationId, ...rest });
  const ids = await insertAuditRows(db, [
    row('2026-11-01T22:59:59.999Z', { actor: 1001 }),
    row('2026-11-01T23:00:00.000Z', { actor: 1001, action: 'repository.disabled' }),
    row('2026-11-01T23:00:00.001Z', { actor: 1002, subject: { type: 'document', id: 4 } }),
    row('2026-11-01T23:59:59.999Z', { actor: 1001, subject: { type: 'document', id: 4 } }),
    row('2026-11-02T00:00:00.000Z', { actor: 1001 }),
  ]);
  const window = 'from=2026-11-02T00:00:00%2B01:00&to=2026-11-02T01:00:00%2B01:00';
  const at = (...indexes: number[]) => indexes.map((index) => ids.at(index));
  const idsFor = (query: string) => idsOf('admin1', t1.installationId, `?${query}`);
  expect(await idsFor(window)).toEqual(at(3, 2, 1));
  expect(await idsFor(`${window}&actorGithubId=1001`)).toEqual(at(3, 1));
  expect(await idsFor(`${window}&action=repository.disabled`)).toEqual(at(1));
  expect(await idsFor(`${window}&subjectType=document&subjectId=4`)).toEqual(at(3, 2));
  expect(await idsFor('from=2026-11-01T23:00:00.000Z&to=2026-11-01T23:00:00.000Z')).toEqual([]);
});

test('a system action has no actor, an erased person shows the scrubbed login, and a subject can be absent', async () => {
  const { db, pageOf, t1 } = await world();
  const row = {
    occurredAt: NEWEST,
    installationId: t1.installationId,
    action: 'installation.suspended',
    actor: null,
  } as const;
  await insertAuditRows(db, [row]);
  await db.updateTable('users').set({ login: 'erased-1001', name: null }).where('github_id', '=', 1001).execute();
  const page = await pageOf('admin1', t1.installationId);
  expect(page.items.map((item) => [item.action, item.actor, item.subject])).toEqual([
    ['installation.suspended', null, null],
    ['repository.enabled', { githubId: 1001, login: 'erased-1001' }, { type: 'repository', id: t1.repositoryId }],
  ]);
});

test("a row of no tenant is in no tenant's page, even for an admin who asks for its action or its subject by name", async () => {
  const { db, idsOf, t1, t2 } = await world();
  const [instanceRow] = await insertAuditRows(db, [
    { occurredAt: NEWEST, installationId: null, action: 'data_export.created', subject: { type: 'user', id: 1001 } },
  ]);
  expect(instanceRow).toBeDefined();
  for (const [who, tenant] of [
    ['admin1', t1],
    ['admin2', t2],
  ] as const) {
    expect(await idsOf(who, tenant.installationId)).not.toContain(instanceRow);
    expect(await idsOf(who, tenant.installationId, '?action=data_export.created')).toEqual([]);
    expect(await idsOf(who, tenant.installationId, '?subjectType=user&subjectId=1001')).toEqual([]);
  }
});

test("a filter on a subject id never matches another tenant's rows, whatever the id, and each admin sees their own", async () => {
  const { db, idsOf, t1, t2 } = await world();
  const subject = { type: 'document', id: 777 } as const;
  const [first] = await insertAuditRows(db, [{ occurredAt: NEWEST, installationId: t1.installationId, subject }]);
  const [second] = await insertAuditRows(db, [{ occurredAt: NEWEST, installationId: t2.installationId, subject }]);
  expect(await idsOf('admin1', t1.installationId, '?subjectType=document&subjectId=777')).toEqual([first]);
  expect(await idsOf('admin2', t2.installationId, '?subjectType=document&subjectId=777')).toEqual([second]);
  // The seeded rows name each tenant's own repository: the other tenant's repository id finds nothing.
  expect(await idsOf('admin1', t1.installationId, `?subjectType=repository&subjectId=${t2.repositoryId}`)).toEqual([]);
  expect(await idsOf('admin2', t2.installationId, `?subjectType=repository&subjectId=${t1.repositoryId}`)).toEqual([]);
});

test('an admin of both tenants sees the entries of each only under the path of that tenant', async () => {
  const { db, roles, roleTable, people, idsOf, stored, t1, t2 } = await world();
  const admin = { login: people.admin1.login, userId: people.admin1.githubId, role: 'admin' } as const;
  roles.load({ ...roleTable, orgs: [...roleTable.orgs, { installation: t2.githubInstallationId, ...admin }] });
  await insertAuditRows(db, [
    { occurredAt: '2026-11-02T10:00:00.000Z', installationId: t1.installationId },
    { occurredAt: '2026-11-02T10:00:01.000Z', installationId: t2.installationId },
    { occurredAt: '2026-11-02T10:00:02.000Z', installationId: t1.installationId },
  ]);
  const own = await stored(t1.installationId);
  const other = await stored(t2.installationId);
  expect([own.length, other.length]).toEqual([3, 2]);
  expect(await idsOf('admin1', t1.installationId)).toEqual(own);
  expect(await idsOf('admin1', t2.installationId)).toEqual(other);
  expect(own.filter((id) => other.includes(id))).toEqual([]);
});

test('the endpoint is read-only: it writes no audit row, for the admin who reads and for the viewer who is refused', async () => {
  const { db, read, t1 } = await world();
  const before = await tenantChecksums(db);
  for (const who of ['admin1', 'admin1', 'repoAdmin1', 'outsider', null] as const) {
    await read(who, t1.installationId, '?limit=1');
  }
  const after = await tenantChecksums(db);
  expect(after['audit_log']).toEqual(before['audit_log']);
  expect(after['audit_log']?.rows).toBe(2);
});
