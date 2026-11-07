// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type RawBuilder, sql } from 'kysely';
import { expect, test } from 'vitest';
import { StubRoleLookup } from '../../services/role-table-fixture/test-support.ts';
import {
  CORPORATE_TABLES,
  TENANT_TABLES,
  type TenantTable,
  tenantChecksums,
  twoTenants,
} from './tenant-fixture/test-support.ts';
import { migratedTestDatabase } from './test-support.ts';

// The fixture of the cross-tenant tests (E11-S06): what `twoTenants` stores, and the checksums that tell a denied call
// changed nothing.

/** `expect.stringMatching` is typed `any`; as `unknown` it can sit in an object literal. */
const md5 = (): unknown => expect.stringMatching(/^[0-9a-f]{32}$/);

async function world() {
  const { db } = await migratedTestDatabase();
  return { db, ...(await twoTenants(db)) };
}

/** The rows of each tenant table that belong to an installation (through the document or the signature for the two tables with no installation column). */
const ROWS_OF: readonly (readonly [TenantTable, (installationId: number) => RawBuilder<unknown>])[] = [
  ['repositories', (id) => sql`select id from repositories where installation_id = ${id}`],
  ['cla_documents', (id) => sql`select id from cla_documents where installation_id = ${id}`],
  [
    'cla_versions',
    (id) =>
      sql`select v.id from cla_versions v join cla_documents d on d.id = v.document_id where d.installation_id = ${id}`,
  ],
  ['signatures', (id) => sql`select id from signatures where installation_id = ${id}`],
  [
    'signer_pii',
    (id) =>
      sql`select p.signature_id from signer_pii p join signatures s on s.id = p.signature_id where s.installation_id = ${id}`,
  ],
  ['commit_overrides', (id) => sql`select id from commit_overrides where installation_id = ${id}`],
  ['allowlist_entries', (id) => sql`select id from allowlist_entries where installation_id = ${id}`],
  ['pr_evaluations', (id) => sql`select id from pr_evaluations where installation_id = ${id}`],
  ['audit_log', (id) => sql`select id from audit_log where installation_id = ${id}`],
  [
    'installation_admin_seen',
    (id) => sql`select user_github_id from installation_admin_seen where installation_id = ${id}`,
  ],
  ['cla_drafts', (id) => sql`select document_id from cla_drafts where installation_id = ${id}`],
  ['merge_group_evaluations', (id) => sql`select id from merge_group_evaluations where installation_id = ${id}`],
];

test('the table of queries names every tenant table', () => {
  expect(ROWS_OF.map(([table]) => table)).toEqual([...TENANT_TABLES]);
});

test('the corporate tables the scan knows are the corporate tables the migrations create, and none is a tenant table of the fixture yet', async () => {
  const { db } = await migratedTestDatabase();
  const { rows } = await sql<{ table_name: string }>`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_name like 'corporate\_%' order by table_name`.execute(db);
  expect(rows.map((row) => row.table_name)).toEqual([...CORPORATE_TABLES].toSorted((a, b) => a.localeCompare(b)));
  const tenantNames = new Set<string>(TENANT_TABLES);
  expect(CORPORATE_TABLES.filter((table) => tenantNames.has(table))).toEqual([]);
});

test.each(ROWS_OF)('%s holds at least one row of each of the two tenants', async (_table, rowsOf) => {
  const { db, t1, t2 } = await world();
  expect((await rowsOf(t1.installationId).execute(db)).rows.length).toBeGreaterThan(0);
  expect((await rowsOf(t2.installationId).execute(db)).rows.length).toBeGreaterThan(0);
});

test('the two tenants are admitted organisations with distinct ids, each with a plain repository and one with its own document', async () => {
  const { db, t1, t2 } = await world();
  const installations = await db.selectFrom('installations').selectAll().orderBy('id').execute();
  expect(installations.map((row) => [row.id, row.account_login, row.account_type, row.admission_status])).toEqual([
    [t1.installationId, 'org-1', 'Organization', 'admitted'],
    [t2.installationId, 'org-2', 'Organization', 'admitted'],
  ]);
  expect([t1.githubInstallationId, t2.githubInstallationId]).toEqual([5000, 10_000]);
  expect(t1.plain.fullName).toBe('org-1/repo');
  expect(t1.scoped.fullName).toBe('org-1/scoped');
  const scoped = await db
    .selectFrom('cla_documents')
    .select('repository_id')
    .where('id', '=', t1.scoped.documentId)
    .executeTakeFirstOrThrow();
  expect(scoped.repository_id).toBe(t1.scoped.repositoryId);
  const plain = await db
    .selectFrom('cla_documents')
    .select('repository_id')
    .where('id', '=', t1.documentId)
    .executeTakeFirstOrThrow();
  expect(plain.repository_id).toBeNull();
});

test('the five people are stored with the login the session of the tests uses, and the two signers are the members who signed', async () => {
  const { db, people, t1, t2 } = await world();
  expect(Object.entries(people).map(([name, who]) => [name, who.githubId, who.login])).toEqual([
    ['admin1', 31_001, 'login-31001'],
    ['admin2', 31_002, 'login-31002'],
    ['repoAdmin1', 31_003, 'login-31003'],
    ['member1', 31_004, 'login-31004'],
    ['outsider', 31_005, 'login-31005'],
  ]);
  const stored = await db
    .selectFrom('users')
    .select(['id', 'github_id', 'login'])
    .where(
      'github_id',
      'in',
      Object.values(people).map((who) => who.githubId),
    )
    .execute();
  expect(stored.toSorted((a, b) => a.id - b.id)).toEqual(
    Object.values(people)
      .map((who) => ({ id: who.userId, github_id: who.githubId, login: who.login }))
      .toSorted((a, b) => a.id - b.id),
  );
  expect([t1.signer.githubId, t2.signer.githubId]).toEqual([people.member1.githubId, people.admin2.githubId]);
  const signatures = await db
    .selectFrom('signatures')
    .select(['id', 'user_id', 'installation_id'])
    .orderBy('id')
    .execute();
  expect(signatures).toEqual([
    { id: t1.signatureId, user_id: people.member1.userId, installation_id: t1.installationId },
    { id: t2.signatureId, user_id: people.admin2.userId, installation_id: t2.installationId },
  ]);
});

test('the role table says what GitHub says: admin1 and admin2 of their organisations, member1 a member, repoAdmin1 admin of one repository', async () => {
  const { roleTable: roles, t1, t2, people } = await world();
  expect(roles.orgs).toEqual([
    {
      installation: t1.githubInstallationId,
      login: people.admin1.login,
      userId: people.admin1.githubId,
      role: 'admin',
    },
    {
      installation: t1.githubInstallationId,
      login: people.member1.login,
      userId: people.member1.githubId,
      role: 'member',
    },
    {
      installation: t2.githubInstallationId,
      login: people.admin2.login,
      userId: people.admin2.githubId,
      role: 'admin',
    },
  ]);
  expect(roles.repositories).toEqual([
    {
      installation: t1.githubInstallationId,
      fullName: 'org-1/scoped',
      login: people.repoAdmin1.login,
      userId: people.repoAdmin1.githubId,
      permission: 'admin',
    },
  ]);
});

test('the checksums name the installations and every tenant table, with their row counts', async () => {
  const { db } = await world();
  const sums = await tenantChecksums(db);
  expect(Object.keys(sums)).toEqual(['installations', ...TENANT_TABLES]);
  expect(sums['installations']?.rows).toBe(2);
  expect(sums['repositories']?.rows).toBe(4);
  expect(sums['cla_documents']?.rows).toBe(4);
  expect(sums['signatures']?.rows).toBe(2);
  expect(Object.values(sums).every((sum) => /^[0-9a-f]{32}$/.test(sum.checksum))).toBe(true);
});

test('an unchanged database has the same checksums, and a change of a row, a new row or a deleted row is seen', async () => {
  const { db, t1 } = await world();
  const before = await tenantChecksums(db);
  expect(await tenantChecksums(db)).toEqual(before);
  await db
    .updateTable('repositories')
    .set({ full_name: 'org-1/changed' })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  const renamed = await tenantChecksums(db);
  expect(renamed['repositories']?.checksum).not.toBe(before['repositories']?.checksum);
  expect(renamed['repositories']?.rows).toBe(before['repositories']?.rows);
  await db.deleteFrom('allowlist_entries').execute();
  const emptied = await tenantChecksums(db);
  expect(emptied['allowlist_entries']).toEqual({ rows: 0, checksum: md5() });
  await db
    .insertInto('commit_overrides')
    .values({
      installation_id: t1.installationId,
      repository_id: t1.scoped.repositoryId,
      commit_sha: 'c'.repeat(40),
      created_by: t1.publisherId,
      reason: 'x',
    })
    .execute();
  expect((await tenantChecksums(db))['commit_overrides']?.rows).toBe(3);
});

test('every table that is not touched keeps its checksum when another one changes', async () => {
  const { db, t1 } = await world();
  const before = await tenantChecksums(db);
  await db
    .updateTable('repositories')
    .set({ full_name: 'org-1/changed' })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  const after = await tenantChecksums(db);
  const earlier = new Map(Object.entries(before));
  const differing = Object.entries(after).filter(([table, sum]) => sum.checksum !== earlier.get(table)?.checksum);
  expect(differing.map(([table]) => table)).toEqual(['repositories']);
});

test('the roles are loaded into the stub the app was built with, which answers them by numeric id', async () => {
  const stub = new StubRoleLookup();
  const { db } = await migratedTestDatabase();
  const { roles, t1, people } = await twoTenants(db, stub);
  expect(roles).toBe(stub);
  expect(await stub.getOrgMembership(t1.githubInstallationId, 'org-1', people.admin1.login)).toEqual({
    state: 'active',
    role: 'admin',
    userId: people.admin1.githubId,
  });
  expect(
    await stub.getRepositoryPermission(t1.githubInstallationId, 'org-1', 'scoped', people.repoAdmin1.login),
  ).toEqual({
    permission: 'admin',
    userId: people.repoAdmin1.githubId,
  });
  expect(await stub.getOrgMembership(t1.githubInstallationId, 'org-1', people.outsider.login)).toBeNull();
});

test('a stub of its own is made when none is given', async () => {
  const { db } = await migratedTestDatabase();
  const { roles, t1, people } = await twoTenants(db);
  expect((await roles.getOrgMembership(t1.githubInstallationId, 'org-1', people.member1.login))?.role).toBe('member');
});
