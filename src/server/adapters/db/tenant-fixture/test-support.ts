// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { z } from 'zod';
import { type GithubId, parseGithubId } from '../../../../shared/github-id.ts';
import { type RoleTable, StubRoleLookup } from '../../../services/role-table-fixture/test-support.ts';
import type { Database } from '../schema.ts';
import { seedSignature, seedTenant, type Tenant } from '../test-support.ts';

// The two tenants of the cross-tenant tests (E11-S06). `twoTenants` extends `seedTenant` (E04-S02): both installations
// are admitted, each tenant holds a plain repository and a repository with a repo-scoped CLA document, and every tenant
// table has at least one row of each tenant, so a statement that strays into the other tenant has something to read,
// change or delete, and a checksum has something to notice.
//
//   tenant 1  organisation `org-1`, GitHub installation 5000, repositories `org-1/repo` and `org-1/scoped`
//   tenant 2  organisation `org-2`, GitHub installation 10000, repositories `org-2/repo` and `org-2/scoped`
// Each tenant's admin has an entry in the ledger of org admins (E11-S07), seen on 2026-05-01, and the repo-scoped document
// of each tenant has a draft at revision 1 (E12-S03, `DRAFT_TEXT`), saved by the tenant's publisher. Each repository `repo` holds
// evaluations of pull requests 7 and 8 (E07), and 9 and 10 (the reporter, E09-S04; see `seedReportRows`).
// People (GitHub knows them by the numeric id; the login is `login-<id>`):
//   admin1 admin of the organisation 1;  admin2 admin of 2;  repoAdmin1 admin of `org-1/scoped` only;
//   member1 plain member of 1;  outsider knows nothing.

/**
 * The tenant tables whose rows have one numeric id a response can name (`signatures.id`, and `signature_id` for
 * `signer_pii`): the rows a route may show, and the ones the route matrix checks the owner of.
 */
export const ROW_TABLES = [
  'repositories',
  'cla_documents',
  'cla_versions',
  'signatures',
  'signer_pii',
  'commit_overrides',
  'allowlist_entries',
  'pr_evaluations',
  'audit_log',
] as const;

export type RowTable = (typeof ROW_TABLES)[number];

/**
 * The tables a tenant owns, or reaches through a composite foreign key: every statement over one of them names the
 * tenant (E11-S06). `cla_versions` and `signer_pii` carry no installation column of their own, they belong to it through
 * their document and their signature. `installations`, the root, is not in the list. The ledger of org admins (E11-S07)
 * is keyed by the pair (installation, person), so no route names one of its rows. The drafts (E12-S03) are keyed by their
 * document, which the path of a route names; a response never names a row of them by an id of its own.
 */
export const TENANT_TABLES = [
  ...ROW_TABLES,
  'installation_admin_seen',
  'cla_drafts',
  'merge_group_evaluations',
] as const;

export type TenantTable = (typeof TENANT_TABLES)[number];

/** The text of the draft the repo-scoped document of tenant `n` holds, so a response that leaks it can be told by its words. */
export const draftTextOf = (n: number): string => `Draft of the repository terms of tenant ${n}\n`;

/** The GitHub ids of the five people. */
const TWO_TENANT_PEOPLE = {
  admin1: 31_001,
  admin2: 31_002,
  repoAdmin1: 31_003,
  member1: 31_004,
  outsider: 31_005,
} as const;

export type PersonName = keyof typeof TWO_TENANT_PEOPLE;

/** A stored person: `users.id`, the GitHub id and the login the session knows. */
interface StoredPerson {
  readonly userId: number;
  readonly githubId: GithubId;
  readonly login: string;
}

/** A repository of a tenant: `repositories.id`, GitHub's id and the display name. */
interface StoredRepository {
  readonly repositoryId: number;
  readonly githubRepoId: GithubId;
  readonly fullName: string;
}

/** What `seedTenant` stores, plus the second repository with its own document and the GitHub ids a role lookup needs. */
export interface TenantWorld extends Tenant {
  readonly githubInstallationId: GithubId;
  /** The GitHub id of the account the installation belongs to (`installations.account_id`). */
  readonly accountId: GithubId;
  readonly accountLogin: string;
  /** The repository of `seedTenant`: no repo-scoped document, so the document of the tenant (`documentId`) covers it. */
  readonly plain: StoredRepository;
  /** A repository with a repo-scoped CLA document of its own. */
  readonly scoped: StoredRepository & { readonly documentId: number };
  /** The tenant's one signer, who stands for the person in `people`, and their signature. */
  readonly signer: StoredPerson;
  /** The person who administers the organisation: the one the ledger of org admins holds an entry for. */
  readonly admin: StoredPerson;
  readonly signatureId: number;
  /** The allowlist entry that covers the whole installation (GitHub id `n * 100`), the one of two the world seeds that is not a repository's (E14-S07). */
  readonly entryId: number;
}

export interface TwoTenants {
  readonly t1: TenantWorld;
  readonly t2: TenantWorld;
  readonly people: Readonly<Record<PersonName, StoredPerson>>;
  /** The role port answered from `roleTable`: what GitHub says about the five people. */
  readonly roles: StubRoleLookup;
  /** The table behind `roles`. */
  readonly roleTable: RoleTable;
}

const DECIDED_AT = new Date('2026-05-01T10:00:00Z');

/** When the ledger last saw the admin of each tenant. */
const ADMIN_SEEN_AT = DECIDED_AT;

const person = (userId: number, githubId: number): StoredPerson => ({
  userId,
  githubId: parseGithubId(githubId),
  login: `login-${githubId}`,
});

async function insertPerson(db: Kysely<Database>, githubId: number): Promise<StoredPerson> {
  const row = await db
    .insertInto('users')
    .values({ github_id: githubId, login: `login-${githubId}`, name: `Name ${githubId}`, avatar_url: null })
    .returning('id')
    .executeTakeFirstOrThrow();
  return person(row.id, githubId);
}

/** The rows around the tenant that no query of E11 creates yet: an override, an allowlist entry, an evaluation, an audit row. */
async function seedPolicyRows(db: Kysely<Database>, tenant: Tenant, n: number): Promise<void> {
  await db
    .insertInto('commit_overrides')
    .values({
      installation_id: tenant.installationId,
      repository_id: tenant.repositoryId,
      commit_sha: 'a'.repeat(40),
      created_by: tenant.publisherId,
      reason: `override of tenant ${n}`,
    })
    .execute();
  await db
    .insertInto('allowlist_entries')
    .values({
      installation_id: tenant.installationId,
      repository_id: null,
      kind: 'user',
      github_id: n * 100,
      created_by: tenant.publisherId,
    })
    .execute();
  await db
    .insertInto('pr_evaluations')
    .values({
      installation_id: tenant.installationId,
      repository_id: tenant.repositoryId,
      pr_number: 7,
      head_sha: 'b'.repeat(40),
      result: 'success',
    })
    .execute();
  await db
    .insertInto('audit_log')
    .values({
      installation_id: tenant.installationId,
      actor_github_id: n * 1000 + 1,
      action: 'repository.enabled',
      subject_type: 'repository',
      subject_id: tenant.repositoryId,
      metadata: JSON.stringify({ repository_id: tenant.repositoryId }),
    })
    .execute();
}

/**
 * The rows the statements of the job queue (E07) need a neighbour for: an allowlist entry of the repository alone, next to the
 * installation-wide one (a read for the repository of another tenant must not meet it), and an evaluation that is still
 * running, which the cancellation and the reaper act on. Its pull request is closed (`pr_state`): the actions of a maintainer
 * evaluate an open pull request whose evaluation is in flight again (E15-S03), and the tests of what they send would otherwise
 * each have to name this one. And (E22-S01) the evaluation of a merge group, whose head SHA is the same for both tenants (the
 * unique key is the repository's) and whose Check Run id names its owner.
 */
async function seedJobRows(db: Kysely<Database>, tenant: Tenant, n: number): Promise<void> {
  await db
    .insertInto('allowlist_entries')
    .values({
      installation_id: tenant.installationId,
      repository_id: tenant.repositoryId,
      kind: 'user',
      github_id: n * 100 + 1,
      created_by: tenant.publisherId,
    })
    .execute();
  await db
    .insertInto('pr_evaluations')
    .values({
      installation_id: tenant.installationId,
      repository_id: tenant.repositoryId,
      pr_number: 8,
      head_sha: 'c'.repeat(40),
      result: 'in_progress',
      pr_state: 'closed',
    })
    .execute();
  await db
    .insertInto('merge_group_evaluations')
    .values({
      installation_id: tenant.installationId,
      repository_id: tenant.repositoryId,
      head_sha: '9'.repeat(40),
      base_sha: '8'.repeat(40),
      result: 'in_progress',
      check_run_id: n * 10_000 + 5,
    })
    .execute();
}

/**
 * The rows the reporter's statements (E09-S04) need a neighbour for. Pull request 9 was evaluated at two head SHAs: the older
 * row has a Check Run and a comment, the newer one (touched a day later) a Check Run only. Pull request 10 shares the older
 * head SHA and has neither. The ids differ per tenant, so a row that strays names its owner.
 */
async function seedReportRows(db: Kysely<Database>, tenant: Tenant, n: number): Promise<void> {
  const row = {
    installation_id: tenant.installationId,
    repository_id: tenant.repositoryId,
    result: 'success',
  } as const;
  await db
    .insertInto('pr_evaluations')
    .values([
      {
        ...row,
        pr_number: 9,
        head_sha: 'e'.repeat(40),
        check_run_id: n * 10_000 + 1,
        comment_id: n * 10_000 + 2,
        updated_at: new Date('2026-05-01T10:00:00Z'),
      },
      {
        ...row,
        pr_number: 9,
        head_sha: 'f'.repeat(40),
        check_run_id: n * 10_000 + 3,
        updated_at: new Date('2026-05-02T10:00:00Z'),
      },
      { ...row, pr_number: 10, head_sha: 'e'.repeat(40) },
    ])
    .execute();
}

/** Admits the installation of `tenant`, stores the repository with its own document and the policy rows around it. */
async function extendTenant(db: Kysely<Database>, tenant: Tenant, n: number, signerGithubId: number) {
  await db
    .updateTable('installations')
    .set({ admission_status: 'admitted', admission_reason: null, admission_decided_at: DECIDED_AT })
    .where('id', '=', tenant.installationId)
    .execute();
  const githubRepoId = parseGithubId(n * 9000 + 1);
  const fullName = `org-${n}/scoped`;
  const repository = await db
    .insertInto('repositories')
    .values({
      installation_id: tenant.installationId,
      github_repo_id: githubRepoId,
      full_name: fullName,
      cla_document_id: null,
      enabled: true,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const document = await db
    .insertInto('cla_documents')
    .values({
      installation_id: tenant.installationId,
      repository_id: repository.id,
      name: 'Repository CLA',
      kind: 'individual',
      active_version_id: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await seedPolicyRows(db, tenant, n);
  await seedJobRows(db, tenant, n);
  await seedReportRows(db, tenant, n);
  await db
    .insertInto('cla_drafts')
    .values({
      document_id: document.id,
      installation_id: tenant.installationId,
      content_md: draftTextOf(n),
      updated_by: tenant.publisherId,
    })
    .execute();
  const signature = await seedSignature(db, tenant, signerGithubId);
  return { scoped: { repositoryId: repository.id, githubRepoId, fullName, documentId: document.id }, signature };
}

/**
 * One tenant as `seedTenant` stores it and `extendTenant` completes it; the ledger holds `admin` as an admin of it, which is
 * the signer when none is given (the signer of tenant 2 is its admin).
 */
async function seedWorld(
  db: Kysely<Database>,
  n: number,
  signerGithubId: number,
  admin?: StoredPerson,
): Promise<TenantWorld> {
  const tenant = await seedTenant(db, n);
  const { scoped, signature } = await extendTenant(db, tenant, n, signerGithubId);
  const signer = person(signature.userId, signerGithubId);
  const stored = admin ?? signer;
  const entry = await db
    .selectFrom('allowlist_entries')
    .select('id')
    .where('installation_id', '=', tenant.installationId)
    .where('repository_id', 'is', null)
    .executeTakeFirstOrThrow();
  await db
    .insertInto('installation_admin_seen')
    .values({ installation_id: tenant.installationId, user_github_id: stored.githubId, seen_at: ADMIN_SEEN_AT })
    .execute();
  return {
    ...tenant,
    githubInstallationId: parseGithubId(n * 5000),
    accountId: parseGithubId(n * 7000),
    accountLogin: `org-${n}`,
    plain: { repositoryId: tenant.repositoryId, githubRepoId: parseGithubId(n * 9000), fullName: `org-${n}/repo` },
    scoped,
    signer,
    admin: stored,
    signatureId: signature.signatureId,
    entryId: entry.id,
  };
}

/** What GitHub says about the five people (see the top of this file). */
function rolesOf(t1: TenantWorld, t2: TenantWorld, people: TwoTenants['people']): RoleTable {
  const org = (tenant: TenantWorld, who: StoredPerson, role: 'admin' | 'member') => ({
    installation: tenant.githubInstallationId,
    login: who.login,
    userId: who.githubId,
    role,
  });
  return {
    orgs: [org(t1, people.admin1, 'admin'), org(t1, people.member1, 'member'), org(t2, people.admin2, 'admin')],
    repositories: [
      {
        installation: t1.githubInstallationId,
        fullName: t1.scoped.fullName,
        login: people.repoAdmin1.login,
        userId: people.repoAdmin1.githubId,
        permission: 'admin',
      },
    ],
  };
}

/**
 * Two admitted tenants with rows in every tenant table, and five people (see the top of this file). `db` is migrated and
 * empty. The roles are loaded into `roles`: pass the stub the app under test was built with, since the app comes first.
 */
export async function twoTenants(db: Kysely<Database>, roles = new StubRoleLookup()): Promise<TwoTenants> {
  const admin1 = await insertPerson(db, TWO_TENANT_PEOPLE.admin1);
  const repoAdmin1 = await insertPerson(db, TWO_TENANT_PEOPLE.repoAdmin1);
  const outsider = await insertPerson(db, TWO_TENANT_PEOPLE.outsider);
  // The two signers are people too: member1 signs in tenant 1 and admin2 in tenant 2, and `seedSignature` stores them.
  const t1 = await seedWorld(db, 1, TWO_TENANT_PEOPLE.member1, admin1);
  const t2 = await seedWorld(db, 2, TWO_TENANT_PEOPLE.admin2);
  const people = { admin1, admin2: t2.signer, repoAdmin1, member1: t1.signer, outsider };
  const roleTable = rolesOf(t1, t2, people);
  roles.load(roleTable);
  return { t1, t2, people, roles, roleTable };
}

/** What one table holds: its number of rows and a hash of all of them, in a fixed order. */
export interface TableChecksum {
  readonly rows: number;
  readonly checksum: string;
}

const checksumRow = z.object({ n: z.number(), checksum: z.string() });

/** Counts and hashes every row of the installations and of every tenant table: two equal results mean nothing in between changed. */
export async function tenantChecksums(db: Kysely<Database>): Promise<Readonly<Record<string, TableChecksum>>> {
  const tables = ['installations', ...TENANT_TABLES] as const;
  const entries = await Promise.all(
    tables.map(async (table) => {
      const { rows } = await sql`
        select count(*)::int as n, md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as checksum
        from ${sql.table(table)} as t`.execute(db);
      const row = checksumRow.parse(rows[0]);
      return [table, { rows: row.n, checksum: row.checksum }] as const;
    }),
  );
  return Object.fromEntries(entries);
}
