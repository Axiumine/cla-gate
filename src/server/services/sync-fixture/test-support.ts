// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { InsertQueryNode, type Kysely, type KyselyPlugin } from 'kysely';
import { type GithubId, parseGithubId } from '../../../shared/github-id.ts';
import type { Database } from '../../adapters/db/schema.ts';
import { CLA_TEXT, publishVersion, seedSignature, sha256, type Tenant } from '../../adapters/db/test-support.ts';
import { type AdmissionWorld, admissionWorld, auditRows, OWNER } from '../admission-fixture/test-support.ts';
import type { InstallationAdmission } from '../installation-admission.ts';
import { createStoredGate } from '../installation-gate.ts';
import { findInstallationByGithubId } from '../installation-queries.ts';
import { createInstallationSync, type InstallationSync } from '../installation-sync.ts';
import type { GitHubInstallation, GitHubRepository } from '../ports/github.ts';
import { FakeGitHub } from '../test-support.ts';

// The installation sync on a migrated database, a scripted GitHub and a captured log (E05-S08). The fake sits behind the
// stored gate, as in production: a repository listing is refused unless the installation row says admitted and active.

export { auditRows, OWNER };

const id = parseGithubId;

/** The permissions the platform needs (docs/github-app.md), so a test that is not about permissions logs no warning. */
const ENOUGH_PERMISSIONS = {
  metadata: 'read',
  pull_requests: 'write',
  checks: 'write',
  issues: 'read',
  members: 'read',
};

/** An installation as GitHub describes it; `accountId` is the account that installed the App (the owner is 9001). */
export function remoteInstallation(
  githubId: number,
  accountId: number,
  overrides: Partial<Omit<GitHubInstallation, 'id' | 'account'>> & {
    login?: string;
    type?: 'Organization' | 'User' | 'Other';
  } = {},
): GitHubInstallation {
  return {
    id: id(githubId),
    account: {
      id: id(accountId),
      login: overrides.login ?? `account-${accountId}`,
      type: overrides.type ?? 'Organization',
    },
    suspendedAt: overrides.suspendedAt ?? null,
    permissions: overrides.permissions ?? ENOUGH_PERMISSIONS,
  };
}

/** A repository as GitHub lists it. */
export const remoteRepository = (githubId: number, fullName = `acme/repo-${githubId}`): GitHubRepository => ({
  id: id(githubId),
  fullName,
});

/** `count` repositories with ids from `first`. */
export const remoteRepositories = (first: number, count: number): GitHubRepository[] =>
  Array.from({ length: count }, (_, index) => remoteRepository(first + index));

export interface SyncWorld extends AdmissionWorld {
  readonly fake: FakeGitHub;
  /** The sync under the policy the world was made with: the owner account and the configured ones. */
  readonly sync: InstallationSync;
  /** The sync for a policy of these configured ids (the owner is always added), on the same database and GitHub. */
  readonly syncFor: (configured: readonly number[]) => InstallationSync;
}

export async function syncWorld(configured: readonly number[] = []): Promise<SyncWorld> {
  const world = await admissionWorld();
  const { db, clock, logger } = world;
  // The gate is not what these tests are about: it serves every account any sync of the world serves (the gate's own
  // policy check is tested in installation-gate.test.ts).
  const served = new Set<GithubId>([OWNER]);
  const fake = new FakeGitHub({
    gate: createStoredGate((githubId) => findInstallationByGithubId(db, githubId), {
      current: () => Promise.resolve({ accountIds: served }),
    }),
  });
  const syncWith = (admission: InstallationAdmission): InstallationSync =>
    createInstallationSync({ db, github: fake, admission, clock, logger });
  const syncFor = (ids: readonly number[]): InstallationSync => {
    for (const account of ids) {
      served.add(id(account));
    }
    return syncWith(world.admissionFor(ids));
  };
  return { ...world, fake, sync: syncFor(configured), syncFor };
}

export const installationRows = (db: Kysely<Database>) =>
  db.selectFrom('installations').selectAll().orderBy('id').execute();

export const repositoryRows = (db: Kysely<Database>) =>
  db.selectFrom('repositories').selectAll().orderBy('installation_id').orderBy('github_repo_id').execute();

/** The surrogate key (`installations.id`) of the installation GitHub knows by this id. */
export async function rowIdOf(db: Kysely<Database>, githubInstallationId: number): Promise<number> {
  const row = await db
    .selectFrom('installations')
    .select('id')
    .where('github_installation_id', '=', githubInstallationId)
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Every audit action, oldest first. */
export async function auditActions(db: Kysely<Database>): Promise<string[]> {
  return (await auditRows(db)).map((row) => row.action);
}

/** Every table a sync writes, as one value: two equal snapshots mean a run wrote nothing. */
export async function stateOf(db: Kysely<Database>) {
  return {
    installations: await installationRows(db),
    repositories: await repositoryRows(db),
    audit: await db.selectFrom('audit_log').selectAll().orderBy('id').execute(),
  };
}

/**
 * Everything a tenant keeps that points at one of its repositories, as counts: documents, signatures, allowlist entries,
 * commit overrides and evaluations. Two equal results mean nothing of the tenant was added, changed or removed.
 */
export async function tenantData(db: Kysely<Database>, installationId: number) {
  const count = async (
    table: 'cla_documents' | 'signatures' | 'allowlist_entries' | 'commit_overrides' | 'pr_evaluations',
  ) => (await db.selectFrom(table).select('id').where('installation_id', '=', installationId).execute()).length;
  return {
    documents: await count('cla_documents'),
    signatures: await count('signatures'),
    allowlist: await count('allowlist_entries'),
    overrides: await count('commit_overrides'),
    evaluations: await count('pr_evaluations'),
  };
}

/** The document of a repository, with a published version 1.0 that is its active one, and the repository switched on. */
async function attachDocument(
  db: Kysely<Database>,
  target: { readonly installationId: number; readonly repositoryId: number },
  publisherId: number,
): Promise<Tenant> {
  const { installationId, repositoryId } = target;
  const document = await db
    .insertInto('cla_documents')
    .values({ installation_id: installationId, repository_id: repositoryId, name: 'CLA', kind: 'individual' })
    .returning('id')
    .executeTakeFirstOrThrow();
  const version = await publishVersion(db, document.id, publisherId, { major: 1, minor: 0, text: CLA_TEXT });
  await db.updateTable('cla_documents').set({ active_version_id: version.id }).where('id', '=', document.id).execute();
  await db
    .updateTable('repositories')
    .set({ enabled: true, cla_document_id: document.id })
    .where('id', '=', repositoryId)
    .execute();
  return {
    installationId,
    repositoryId,
    documentId: document.id,
    versionId: version.id,
    publisherId,
    contentSha256: sha256(CLA_TEXT),
  };
}

/** An allowlist entry, a commit override and a finished evaluation of the repository, whose Check Run has the id 555. */
async function attachEvaluationInputs(db: Kysely<Database>, tenant: Tenant): Promise<void> {
  const scope = { installation_id: tenant.installationId, repository_id: tenant.repositoryId };
  await db
    .insertInto('allowlist_entries')
    .values({ ...scope, kind: 'user', github_id: 77, created_by: tenant.publisherId })
    .execute();
  await db
    .insertInto('commit_overrides')
    .values({ ...scope, commit_sha: 'a'.repeat(40), created_by: tenant.publisherId, reason: 'test' })
    .execute();
  await db
    .insertInto('pr_evaluations')
    .values({ ...scope, pr_number: 1, head_sha: 'b'.repeat(40), result: 'success', check_run_id: 555 })
    .execute();
}

/**
 * Gives a stored repository what a maintainer builds over time: enforcement on, a CLA document with a published version,
 * a signature, an allowlist entry, a commit override and a finished evaluation. Returns the ids as a {@link Tenant}.
 * `n` makes the GitHub user ids unique, so two repositories can be given data in one database.
 */
async function attachTenantData(
  db: Kysely<Database>,
  target: { readonly installationId: number; readonly repositoryId: number },
  n = 1,
): Promise<Tenant> {
  const publisher = await db
    .insertInto('users')
    .values({ github_id: n * 1000 + 1, login: `publisher-${n}`, name: null, avatar_url: null })
    .returning('id')
    .executeTakeFirstOrThrow();
  const tenant = await attachDocument(db, target, publisher.id);
  await seedSignature(db, tenant, n * 1000 + 2);
  await attachEvaluationInputs(db, tenant);
  return tenant;
}

/** A database plugin that makes the `nth` insert into `repositories` fail, as a full disk would, and counts none after it. */
export function failRepositoryInsert(nth: number): KyselyPlugin {
  let seen = 0;
  return {
    transformQuery: ({ node }) => {
      if (InsertQueryNode.is(node) && node.into?.table.identifier.name === 'repositories') {
        seen += 1;
        if (seen === nth) {
          throw new Error('disk full');
        }
      }
      return node;
    },
    transformResult: ({ result }) => Promise.resolve(result),
  };
}

/** The account that installs the App as tenant B; the policy of these worlds allows it. */
export const OTHER_ACCOUNT = 5000;

/** The GitHub id of the repository that moves from tenant A to tenant B. */
export const SHARED = 300;

export const A_INSTALLATION = 11;
export const B_INSTALLATION = 12;

export interface TransferWorld extends SyncWorld {
  /** What tenant A has attached to the repository that is about to move: ids of its document, version and so on. */
  readonly shared: Tenant;
  /** `installations.id` of tenant B. */
  readonly bId: number;
}

/**
 * Tenant A (installation 11, the owner) holds repositories 100, 101 and {@link SHARED} (`acme/shared`, enforcement on,
 * with a document, a signature, an allowlist entry, an override and an evaluation); tenant B (installation 12, an
 * allowed account) holds 200 and 201. Both are synced. The repository has not moved on GitHub yet: see {@link moveShared}.
 */
export async function transferWorld(): Promise<TransferWorld> {
  const world = await syncWorld([OTHER_ACCOUNT]);
  const shared = remoteRepository(SHARED, 'acme/shared');
  world.fake.addInstallation(remoteInstallation(A_INSTALLATION, OWNER), [...remoteRepositories(100, 2), shared]);
  world.fake.addInstallation(remoteInstallation(B_INSTALLATION, OTHER_ACCOUNT), remoteRepositories(200, 2));
  await world.sync.syncInstallation(id(A_INSTALLATION));
  await world.sync.syncInstallation(id(B_INSTALLATION));
  const aId = await rowIdOf(world.db, A_INSTALLATION);
  const row = await world.db
    .selectFrom('repositories')
    .select('id')
    .where('github_repo_id', '=', SHARED)
    .executeTakeFirstOrThrow();
  const attached = await attachTenantData(world.db, { installationId: aId, repositoryId: row.id });
  return { ...world, shared: attached, bId: await rowIdOf(world.db, B_INSTALLATION) };
}

/** On GitHub, {@link SHARED} leaves tenant A and appears in tenant B's list under another owner and name. */
export function moveShared(world: SyncWorld, newName = 'newowner/shared'): void {
  world.fake.setRepositories(id(A_INSTALLATION), remoteRepositories(100, 2));
  world.fake.setRepositories(id(B_INSTALLATION), [...remoteRepositories(200, 2), remoteRepository(SHARED, newName)]);
}
