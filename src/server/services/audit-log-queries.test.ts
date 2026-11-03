// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { migratedTestDatabase, seedTenant } from '../adapters/db/test-support.ts';
import { type AuditRowSpec, insertAuditRows } from './audit-log-fixture/test-support.ts';
import { type AuditLogRequest, listAuditLog } from './audit-log-queries.ts';

// The data function of the audit log viewer (E16-S02), on two tenants. The HTTP side (roles, the validation of the query
// string) is in adapters/http/audit-log-routes.test.ts.

/** Two seeded tenants: the publishers 1001 and 2001 are their users. */
async function world() {
  const { db } = await migratedTestDatabase();
  const t1 = await seedTenant(db, 1);
  const t2 = await seedTenant(db, 2);
  const list = (tenant: typeof t1, request: Partial<AuditLogRequest> = {}) =>
    listAuditLog(db, { installationId: tenant.installationId }, { limit: 50, ...request });
  return { db, t1, t2, list };
}

/** The cursor a page returned, as the route hands it to the query. */
function decodeFor(cursor: string) {
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  const [occurredAt, id] = z.tuple([z.string(), z.number()]).parse(JSON.parse(text));
  return { occurredAt, id };
}

/** The ids at these positions of the ids a fixture returned. */
const pick = (ids: readonly number[], indexes: readonly number[]) => indexes.map((index) => ids.at(index));

const at = (time: string): string => `2026-11-02T10:00:${time}Z`;

test('a page holds the rows of the tenant, newest first, in the shape of the viewer', async () => {
  const { db, t1, t2, list } = await world();
  const [older, newer] = await insertAuditRows(db, [
    {
      occurredAt: at('00.000'),
      installationId: t1.installationId,
      subject: { type: 'repository', id: 11 },
      metadata: { repository_id: 11, enabled: true },
    },
    { occurredAt: at('01.000'), installationId: t1.installationId, action: 'installation.suspended', actor: null },
    { occurredAt: at('02.000'), installationId: t2.installationId },
  ]);
  expect(await list(t1)).toEqual({
    items: [
      {
        id: newer,
        occurredAt: '2026-11-02T10:00:01.000Z',
        action: 'installation.suspended',
        actor: null,
        subject: null,
        metadata: {},
      },
      {
        id: older,
        occurredAt: '2026-11-02T10:00:00.000Z',
        action: 'repository.enabled',
        actor: { githubId: 1001, login: 'publisher-1' },
        subject: { type: 'repository', id: 11 },
        metadata: { repository_id: 11, enabled: true },
      },
    ],
    nextCursor: null,
  });
});

test('the metadata is returned as stored, with every kind of value the audit check allows', async () => {
  const { db, t1, list } = await world();
  const metadata = { count: 3, enabled: false, reason_code: 'policy_changed', affected_signatures: [4, 5], kind: null };
  await insertAuditRows(db, [{ occurredAt: at('00.000'), installationId: t1.installationId, metadata }]);
  expect((await list(t1)).items.map((item) => item.metadata)).toEqual([metadata]);
});

test('a row of no tenant is never returned, whatever the filter, to either tenant', async () => {
  const { db, t1, t2, list } = await world();
  await insertAuditRows(db, [
    {
      occurredAt: at('00.000'),
      installationId: null,
      action: 'data_export.created',
      subject: { type: 'user', id: 1001 },
    },
    { occurredAt: at('01.000'), installationId: null, action: 'network_metadata.purged', actor: null },
  ]);
  for (const tenant of [t1, t2]) {
    expect((await list(tenant)).items).toEqual([]);
    expect((await list(tenant, { action: 'data_export.created' })).items).toEqual([]);
    expect((await list(tenant, { actorGithubId: 1001, subjectType: 'user', subjectId: 1001 })).items).toEqual([]);
  }
});

test('the login is read from the users snapshot when the page is asked for, so a rename and an erasure show at once', async () => {
  const { db, t1, list } = await world();
  await insertAuditRows(db, [{ occurredAt: at('00.000'), installationId: t1.installationId }]);
  const login = async () => (await list(t1)).items.map((item) => item.actor?.login);
  expect(await login()).toEqual(['publisher-1']);
  await db.updateTable('users').set({ login: 'renamed' }).where('github_id', '=', 1001).execute();
  expect(await login()).toEqual(['renamed']);
  // What the erasure function of the initial migration does to the snapshot of the person.
  await db.updateTable('users').set({ login: 'erased-1001', name: null }).where('github_id', '=', 1001).execute();
  expect(await login()).toEqual(['erased-1001']);
});

test('an actor the instance holds no user row for is shown by id with no login, and a login is never read from the audit table', async () => {
  const { db, t1, list } = await world();
  await insertAuditRows(db, [{ occurredAt: at('00.000'), installationId: t1.installationId, actor: 424_242 }]);
  expect((await list(t1)).items.map((item) => item.actor)).toEqual([{ githubId: 424_242, login: null }]);
  const { rows: columns } = await sql<{ column_name: string }>`
    select column_name from information_schema.columns where table_name = 'audit_log'`.execute(db);
  expect(columns.map((column) => column.column_name)).not.toContain('login');
});

/** Five rows of tenant 1 and the same five of tenant 2: a filter that ignored the tenant would find ten. */
const FILTER_ROWS = [
  { occurredAt: at('00.000'), action: 'repository.enabled', actor: 1001, subject: { type: 'repository', id: 5 } },
  { occurredAt: at('01.000'), action: 'repository.disabled', actor: 1002, subject: { type: 'repository', id: 5 } },
  { occurredAt: at('02.000'), action: 'repository.enabled', actor: 1002, subject: { type: 'document', id: 5 } },
  { occurredAt: at('03.000'), action: 'installation.suspended', actor: null, subject: null },
  { occurredAt: at('04.000'), action: 'repository.enabled', actor: 1001, subject: { type: 'repository', id: 6 } },
] as const;

test.each([
  ['action', { action: 'repository.enabled' }, [4, 2, 0]],
  ['actorGithubId', { actorGithubId: 1002 }, [2, 1]],
  ['subjectType', { subjectType: 'repository' }, [4, 1, 0]],
  ['subjectId', { subjectId: 5 }, [2, 1, 0]],
  ['subjectType and subjectId', { subjectType: 'repository', subjectId: 5 }, [1, 0]],
  ['action and actorGithubId', { action: 'repository.enabled', actorGithubId: 1001 }, [4, 0]],
  ['an actor with no row', { actorGithubId: 7 }, []],
  ['a system action by its action', { action: 'installation.suspended' }, [3]],
] as const)(
  'the filter %s selects those rows of the tenant and none of the other tenant',
  async (_name, filter, expected) => {
    const { db, t1, t2, list } = await world();
    const own = await insertAuditRows(
      db,
      FILTER_ROWS.map((row) => ({ ...row, installationId: t1.installationId })),
    );
    const other = await insertAuditRows(
      db,
      FILTER_ROWS.map((row) => ({ ...row, installationId: t2.installationId })),
    );
    expect((await list(t1, filter)).items.map((item) => item.id)).toEqual(pick(own, expected));
    expect((await list(t2, filter)).items.map((item) => item.id)).toEqual(pick(other, expected));
  },
);

test('from is inclusive and to is exclusive, to the millisecond and to the microsecond', async () => {
  const { db, t1, list } = await world();
  const instants = [
    at('00.999999'),
    at('01.000000'),
    at('01.000001'),
    at('01.000500'),
    at('01.001000'),
    at('01.999000'),
    at('01.999999'),
    at('02.000000'),
    at('02.000001'),
    at('02.001000'),
  ];
  const ids = await insertAuditRows(
    db,
    instants.map((occurredAt) => ({ occurredAt, installationId: t1.installationId })),
  );
  const between = await list(t1, { from: new Date(at('01.000')), to: new Date(at('02.000')) });
  expect(between.items.map((item) => item.id)).toEqual(pick(ids, [6, 5, 4, 3, 2, 1]));
  const millisecond = await list(t1, { from: new Date(at('00.999')), to: new Date(at('02.001')) });
  expect(millisecond.items.map((item) => item.id)).toEqual(pick(ids, [8, 7, 6, 5, 4, 3, 2, 1, 0]));
  expect((await list(t1, { from: new Date(at('02.000')) })).items.map((item) => item.id)).toEqual(pick(ids, [9, 8, 7]));
  expect((await list(t1, { to: new Date(at('01.000')) })).items.map((item) => item.id)).toEqual([ids[0]]);
  expect((await list(t1, { from: new Date(at('02.000')), to: new Date(at('01.000')) })).items).toEqual([]);
});

/** 250 rows of tenant 1 that share one instant, with rows of tenant 2 and of no tenant at the same instant. */
async function sharedInstant() {
  const state = await world();
  const same = at('00.000');
  const rows: AuditRowSpec[] = Array.from({ length: 250 }, () => ({
    occurredAt: same,
    installationId: state.t1.installationId,
  }));
  const ids = await insertAuditRows(state.db, rows);
  await insertAuditRows(state.db, [
    { occurredAt: same, installationId: state.t2.installationId },
    { occurredAt: same, installationId: null, action: 'data_export.created' },
  ]);
  return { ...state, ids };
}

test.each([7, 100, 200])(
  'walking 250 rows that share one instant with a page of %i gives each row once, in descending id order',
  async (limit) => {
    const { t1, list, ids } = await sharedInstant();
    const seen: number[] = [];
    let cursor: Awaited<ReturnType<typeof list>>['nextCursor'] = null;
    let pages = 0;
    do {
      const request = cursor === null ? {} : { cursor: decodeFor(cursor) };
      const page = await list(t1, { limit, ...request });
      expect(page.items.length).toBeLessThanOrEqual(limit);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null);
    expect(seen).toEqual(ids.toSorted((a, b) => b - a));
    expect(pages).toBe(Math.ceil(250 / limit));
  },
);

test('rows of one millisecond that differ in the microsecond are walked in order with a page of one, with none skipped', async () => {
  const { db, t1, list } = await world();
  const ids = await insertAuditRows(
    db,
    [at('00.123100'), at('00.123900'), at('00.123300'), at('00.123300'), at('00.124000')].map((occurredAt) => ({
      occurredAt,
      installationId: t1.installationId,
    })),
  );
  const seen: number[] = [];
  let page = await list(t1, { limit: 1 });
  seen.push(...page.items.map((item) => item.id));
  while (page.nextCursor !== null) {
    page = await list(t1, { limit: 1, cursor: decodeFor(page.nextCursor) });
    seen.push(...page.items.map((item) => item.id));
  }
  // Newest instant first; the two rows at .123300 by descending id.
  expect(seen).toEqual([ids[4], ids[1], ids[3], ids[2], ids[0]]);
});

test('the cursor names the microsecond instant and the id of the last row of the page, and there is none after the last page', async () => {
  const { db, t1, list } = await world();
  const ids = await insertAuditRows(
    db,
    [at('00.000100'), at('00.000200'), at('00.000300')].map((occurredAt) => ({
      occurredAt,
      installationId: t1.installationId,
    })),
  );
  const first = await list(t1, { limit: 2 });
  expect(first.items).toHaveLength(2);
  expect(decodeFor(first.nextCursor ?? '')).toEqual({ occurredAt: '2026-11-02T10:00:00.000200Z', id: ids[1] });
  expect((await list(t1, { limit: 3 })).nextCursor).toBeNull();
  expect((await list(t1, { limit: 4 })).nextCursor).toBeNull();
  const second = await list(t1, { limit: 2, cursor: { occurredAt: '2026-11-02T10:00:00.000200Z', id: ids[1] ?? 0 } });
  expect(second).toMatchObject({ items: [{ id: ids[0] }], nextCursor: null });
});

test('a cursor only says where to start: it never widens the tenant, whose rows are all that a page can hold', async () => {
  const { db, t1, t2, list } = await world();
  await insertAuditRows(db, [
    { occurredAt: at('00.000'), installationId: t1.installationId },
    { occurredAt: at('00.000'), installationId: t2.installationId },
  ]);
  const page = await list(t1, { cursor: { occurredAt: at('00.000000'), id: 2_147_483_647 } });
  expect(page.items.map((item) => item.id)).toHaveLength(1);
  const [only] = (await list(t2)).items;
  expect(page.items.map((item) => item.id)).not.toContain(only?.id);
});
