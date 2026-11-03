// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { parseGithubId } from '../../../../shared/github-id.ts';
import { forgetAdminSeen, recordAdminSeen, wasAdminSeenSince } from '../../../services/admin-ledger-queries.ts';
import { findDocument, listDocuments, listRepositoryDocuments } from '../../../services/cla-document-queries.ts';
import { countDocuments, insertDocument, updateDocumentName } from '../../../services/cla-document-writes.ts';
import { findDocumentPlacement, findSignaturePlacement } from '../../../services/document-placement.ts';
import { listInstallationsForOperator } from '../../../services/installation-operator.ts';
import { listRepoAdminCandidates } from '../../../services/repo-admin-candidates.ts';
import { RepositoryNotFoundError, setRepositoryEnabled } from '../../../services/repository-enabled.ts';
import {
  findActiveRepositoryByGithubId,
  findRepositoryByGithubId,
  isActiveRepositoryOfAnotherInstallation,
  listActiveRepositoryIds,
  listEnabledRepositories,
  markRepositoriesRemoved,
  renameActiveRepository,
} from '../../../services/repository-queries.ts';
import { storedStates, writeChanged } from '../../../services/repository-statements.ts';
import { releaseTransferred } from '../../../services/repository-transfer.ts';
import {
  findAdmittedTenantRows,
  findTenantRows,
  installationOfRepository,
  type TenantRows,
} from '../../../services/tenant-queries.ts';
import type { Database } from '../schema.ts';
import type { TenantWorld } from '../tenant-fixture/test-support.ts';
import { JOB_TENANT_QUERIES } from '../tenant-jobs-fixture/test-support.ts';
import { assertRepositoryInTenant, TenantMismatchError, type TenantScope } from '../tenant-scope.ts';

// The registry of the tenant data access (E11-S06). `TENANT_MODULES` lists the files that run a statement over a tenant
// table; `TENANT_QUERIES` has an entry for every function they export, with the factory of its fixture arguments: how to
// call it for a tenant and for the ids of a tenant. The generated test calls each entry for tenant 1 with tenant 1's ids and
// with tenant 2's, and a file that touches a tenant table without being listed, or a function that is listed nowhere, fails
// the build (tenant-modules.test.ts), so a query cannot ship without the cross-tenant check.

/** The files that run a statement over a tenant table, relative to `src/server`. */
export const TENANT_MODULES = [
  'adapters/db/tenant-scope.ts',
  'services/admin-ledger-queries.ts',
  'services/close-pr/close-heads.ts',
  'services/close-pr/close-rows.ts',
  'services/cla-document-queries.ts',
  'services/cla-document-writes.ts',
  'services/document-placement.ts',
  'services/evaluate-pr/evaluation-rows.ts',
  'services/evaluate-pr/policy-facts.ts',
  'services/evaluate-pr/signature-facts.ts',
  'services/installation-operator.ts',
  'services/repo-admin-candidates.ts',
  'services/repository-enabled.ts',
  'services/repository-queries.ts',
  'services/repository-statements.ts',
  'services/repository-transfer.ts',
  'services/sweep/sweep-rows.ts',
  'services/tenant-queries.ts',
] as const;

/**
 * The one file that writes `audit_log`: rows are appended inside the transaction of the change they record, naming the
 * installation the entry carries (E04-S09), and nothing else inserts them. Reads of the table belong to a tenant module.
 */
export const AUDIT_WRITER = 'services/audit.ts';

/** The error is the one a refused call throws. */
export type Refusal = (error: unknown) => boolean;

/**
 * A function that takes the tenant and answers with its rows. `run` calls it with `scope` (the tenant it acts for) and the ids
 * of `ids` (the tenant whose resources it is asked about), and returns the installation id that owns each row it read or
 * changed, found by reading the rows again, not by trusting the answer.
 */
export interface ScopedQuery {
  readonly kind: 'scoped';
  /**
   * False for a function that takes the scope and nothing else (a list), or whose other arguments name a person, who
   * belongs to no tenant: there are no ids of another tenant to hand it. The test with another tenant's ids is not run.
   */
  readonly takesIds: boolean;
  /** True when it reads or changes the repositories that are not removed only: with every repository of the tenant removed it finds nothing. */
  readonly activeOnly: boolean;
  /** Set for a function that turns a foreign id away with an error instead of answering nothing; the error is told by this. */
  readonly refusal?: Refusal;
  readonly run: (db: Kysely<Database>, scope: TenantScope, ids: TenantWorld) => Promise<readonly number[]>;
}

/**
 * A function that meets another tenant's rows by design (E05-S09, E11-S05, E05-S07). Its behaviour is pinned by `pinnedBy`, a
 * test file next to it that names the function, and `reason` says why it does not take the scope the way the others do.
 * `run` calls it like a scoped query would be, for `scope` with the ids of `ids`, and answers what the call showed or
 * changed; `answers` says what that is for the tenant's own ids and for another tenant's, which is not "nothing" here.
 */
interface ByDesignQuery {
  readonly kind: 'by_design';
  readonly reason: string;
  readonly pinnedBy: string;
  readonly run: (db: Kysely<Database>, scope: TenantScope, ids: TenantWorld) => Promise<unknown>;
  readonly answers: (own: TenantWorld, other: TenantWorld) => { readonly own: unknown; readonly foreign: unknown };
}

export type TenantQuery = ScopedQuery | ByDesignQuery;

/** The `Error` of a database that refused a statement for a unique index (`23505`). */
const isUniqueViolation: Refusal = (error) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';

/** The installation that owns each repository stored under these GitHub ids, in any state. */
async function ownersOfGithubIds(db: Kysely<Database>, githubRepoIds: readonly number[]): Promise<number[]> {
  if (githubRepoIds.length === 0) {
    return [];
  }
  const rows = await db
    .selectFrom('repositories')
    .select('installation_id')
    .where('github_repo_id', 'in', githubRepoIds)
    .execute();
  return rows.map((row) => row.installation_id);
}

/** The installation that owns each repository with these row ids. */
async function ownersOfRepositories(db: Kysely<Database>, repositoryIds: readonly number[]): Promise<number[]> {
  const rows = await db.selectFrom('repositories').select('installation_id').where('id', 'in', repositoryIds).execute();
  return rows.map((row) => row.installation_id);
}

/**
 * The installations that own the rows the guard's read returned: the installation and its repository, which the
 * registry always asks for.
 * @throws Error when the read answers an installation with no repository: the entry asked for one.
 */
export function ownersOfTenantRows(rows: TenantRows | null): number[] {
  if (rows === null) {
    return [];
  }
  if (rows.repository === null) {
    throw new Error('the registry asks for a repository and the read answered none');
  }
  return [rows.installation.id, rows.repository.installation_id];
}

/** The installation that owns each document with these row ids. */
async function ownersOfDocuments(db: Kysely<Database>, documentIds: readonly number[]): Promise<number[]> {
  const rows = await db.selectFrom('cla_documents').select('installation_id').where('id', 'in', documentIds).execute();
  return rows.map((row) => row.installation_id);
}

/** The installation that owns each document of the database, in any tenant. */
async function ownersOfAllDocuments(db: Kysely<Database>): Promise<number[]> {
  const rows = await db.selectFrom('cla_documents').select('installation_id').execute();
  return rows.map((row) => row.installation_id);
}

/** The installation that owns each signature with these row ids. */
async function ownersOfSignatures(db: Kysely<Database>, signatureIds: readonly number[]): Promise<number[]> {
  const rows = await db.selectFrom('signatures').select('installation_id').where('id', 'in', signatureIds).execute();
  return rows.map((row) => row.installation_id);
}

/** The GitHub ids of the repositories that are removed, in any tenant. */
async function removedRepositories(db: Kysely<Database>): Promise<number[]> {
  const rows = await db
    .selectFrom('repositories')
    .select('github_repo_id')
    .where('removed_at', 'is not', null)
    .execute();
  return rows.map((row) => row.github_repo_id);
}

/** The installations that hold an entry of the ledger of org admins for this person, found by reading the table. */
async function ledgerOwnersOf(db: Kysely<Database>, person: number): Promise<number[]> {
  const rows = await db
    .selectFrom('installation_admin_seen')
    .select('installation_id')
    .where('user_github_id', '=', person)
    .execute();
  return rows.map((row) => row.installation_id);
}

const RENAMED = 'renamed/by-test';
const WHEN = new Date('2026-07-01T00:00:00Z');

const scoped = (
  options: Pick<ScopedQuery, 'takesIds' | 'activeOnly' | 'run'> & { readonly refusal?: Refusal },
): ScopedQuery => ({ kind: 'scoped', ...options });

/** Every exported function of every module of {@link TENANT_MODULES}, by module and name. */
export const TENANT_QUERIES: Readonly<Record<string, Readonly<Record<string, TenantQuery>>>> = {
  'adapters/db/tenant-scope.ts': {
    assertRepositoryInTenant: scoped({
      takesIds: true,
      activeOnly: false,
      refusal: (error) => error instanceof TenantMismatchError,
      run: async (db, scope, ids) => {
        await assertRepositoryInTenant(db, scope, ids.plain.repositoryId);
        return ownersOfRepositories(db, [ids.plain.repositoryId]);
      },
    }),
  },
  'services/admin-ledger-queries.ts': {
    recordAdminSeen: scoped({
      // The person is the ledger's key next to the tenant, not a resource of one: no other tenant's id exists to hand it.
      takesIds: false,
      activeOnly: false,
      run: async (db, scope, ids) => {
        await recordAdminSeen(db, scope, ids.admin.githubId, { seenAt: WHEN, refreshAtOrBefore: WHEN });
        return ledgerOwnersOf(db, ids.admin.githubId);
      },
    }),
    forgetAdminSeen: scoped({
      takesIds: true,
      activeOnly: false,
      run: async (db, scope, ids) => {
        const before = await ledgerOwnersOf(db, ids.admin.githubId);
        await forgetAdminSeen(db, scope, ids.admin.githubId);
        const after = await ledgerOwnersOf(db, ids.admin.githubId);
        return before.filter((owner) => !after.includes(owner));
      },
    }),
    wasAdminSeenSince: scoped({
      takesIds: true,
      activeOnly: false,
      run: async (db, scope, ids) =>
        (await wasAdminSeenSince(db, scope, ids.admin.githubId, new Date('2026-01-01T00:00:00Z')))
          ? ledgerOwnersOf(db, ids.admin.githubId)
          : [],
    }),
  },
  'services/cla-document-queries.ts': {
    findDocument: scoped({
      takesIds: true,
      activeOnly: false,
      run: async (db, scope, ids) => {
        const document = await findDocument(db, scope, ids.documentId);
        return document === null ? [] : ownersOfDocuments(db, [document.id]);
      },
    }),
    listDocuments: scoped({
      takesIds: false,
      activeOnly: false,
      run: async (db, scope) => {
        const documents = await listDocuments(db, scope, { limit: 100, from: null });
        // Id 0 names no document: the query stays valid for a tenant that has none.
        return ownersOfDocuments(db, [0, ...documents.map((document) => document.id)]);
      },
    }),
    listRepositoryDocuments: scoped({
      takesIds: true,
      activeOnly: true,
      run: async (db, scope, ids) => {
        const documents = await listRepositoryDocuments(db, scope, ids.scoped.repositoryId);
        const shown = [...(documents?.repositoryScoped ?? []), ...(documents?.installationScoped ?? [])];
        return shown.length === 0
          ? []
          : ownersOfDocuments(
              db,
              shown.map((document) => document.id),
            );
      },
    }),
  },
  'services/cla-document-writes.ts': {
    countDocuments: scoped({
      // The count belongs to the tenant it is asked for; there is no document of another tenant to name.
      takesIds: false,
      activeOnly: false,
      run: async (db, scope) => {
        const counted = await countDocuments(db, scope);
        const owned = await ownersOfAllDocuments(db);
        // A count that strayed into another tenant is more than the rows that tenant owns: the surplus moves the id to one that is another tenant's.
        return [scope.installationId + counted - owned.filter((owner) => owner === scope.installationId).length];
      },
    }),
    insertDocument: scoped({
      takesIds: true,
      activeOnly: true,
      run: async (db, scope, ids) => {
        const document = await insertDocument(db, scope, {
          name: 'Registry document',
          kind: 'individual',
          repositoryId: ids.plain.repositoryId,
        });
        return document === null ? [] : ownersOfDocuments(db, [document.id]);
      },
    }),
    updateDocumentName: scoped({
      takesIds: true,
      activeOnly: false,
      run: async (db, scope, ids) => {
        const document = await updateDocumentName(db, scope, ids.scoped.documentId, RENAMED);
        return document === null ? [] : ownersOfDocuments(db, [document.id]);
      },
    }),
  },
  'services/document-placement.ts': {
    findDocumentPlacement: scoped({
      takesIds: true,
      activeOnly: false,
      run: async (db, scope, ids) => {
        const placement = await findDocumentPlacement(db, scope, ids.scoped.documentId);
        return placement === null ? [] : ownersOfDocuments(db, [ids.scoped.documentId]);
      },
    }),
    findSignaturePlacement: scoped({
      takesIds: true,
      activeOnly: false,
      run: async (db, scope, ids) => {
        const placement = await findSignaturePlacement(db, scope, ids.signatureId);
        return placement === null ? [] : ownersOfSignatures(db, [ids.signatureId]);
      },
    }),
  },
  'services/installation-operator.ts': {
    listInstallationsForOperator: {
      kind: 'by_design',
      reason:
        "the operator sees every installation of the instance, with counts of its repositories and no person (E05-S07); it reads across tenants on purpose and grants no access to a tenant's data (E11-S08)",
      pinnedBy: 'services/installation-operator.test.ts',
      run: async (db) => (await listInstallationsForOperator(db)).map((row) => row.githubInstallationId),
      answers: (own, other) => {
        const both = [own.githubInstallationId, other.githubInstallationId];
        return { own: both, foreign: both };
      },
    },
  },
  'services/repo-admin-candidates.ts': {
    listRepoAdminCandidates: scoped({
      takesIds: false,
      activeOnly: true,
      run: async (db, scope) => {
        const candidates = await listRepoAdminCandidates(db, scope, 10);
        return ownersOfGithubIds(
          db,
          candidates.map((candidate) => candidate.github_repo_id),
        );
      },
    }),
  },
  'services/repository-enabled.ts': {
    setRepositoryEnabled: scoped({
      takesIds: true,
      activeOnly: true,
      refusal: (error) => error instanceof RepositoryNotFoundError,
      run: async (db, scope, ids) => {
        const { changed } = await setRepositoryEnabled(db, {
          installationId: scope.installationId,
          githubRepoId: ids.plain.githubRepoId,
          enabled: true,
          actorGithubId: parseGithubId(1),
        });
        return changed ? ownersOfGithubIds(db, [ids.plain.githubRepoId]) : [];
      },
    }),
  },
  'services/repository-queries.ts': {
    markRepositoriesRemoved: scoped({
      takesIds: true,
      activeOnly: true,
      run: async (db, scope, ids) =>
        ownersOfGithubIds(db, await markRepositoriesRemoved(db, scope.installationId, [ids.plain.githubRepoId], WHEN)),
    }),
    renameActiveRepository: scoped({
      takesIds: true,
      activeOnly: true,
      run: async (db, scope, ids) => {
        const changed = await renameActiveRepository(db, scope.installationId, ids.plain.githubRepoId, RENAMED);
        return changed ? ownersOfGithubIds(db, [ids.plain.githubRepoId]) : [];
      },
    }),
    findActiveRepositoryByGithubId: scoped({
      takesIds: true,
      activeOnly: true,
      run: async (db, scope, ids) => {
        const row = await findActiveRepositoryByGithubId(db, scope.installationId, ids.plain.githubRepoId);
        return row === null ? [] : [row.installation_id];
      },
    }),
    findRepositoryByGithubId: scoped({
      takesIds: true,
      activeOnly: false,
      run: async (db, scope, ids) => {
        const row = await findRepositoryByGithubId(db, scope.installationId, ids.plain.githubRepoId);
        return row === null ? [] : [row.installation_id];
      },
    }),
    listActiveRepositoryIds: scoped({
      takesIds: false,
      activeOnly: true,
      run: async (db, scope) => ownersOfGithubIds(db, await listActiveRepositoryIds(db, scope.installationId)),
    }),
    listEnabledRepositories: scoped({
      takesIds: false,
      activeOnly: true,
      // The fixture enables the repository with its own document of each tenant, so the list has a foreign row to leave out.
      run: async (db, scope) =>
        (await listEnabledRepositories(db, scope.installationId)).map((row) => row.installation_id),
    }),
    isActiveRepositoryOfAnotherInstallation: {
      kind: 'by_design',
      reason:
        "a repository is active under one installation only, and the transfer check (E06-S05) asks whether another one holds it: the statement excludes the caller's tenant and answers a boolean, never a row",
      pinnedBy: 'services/repository-held-elsewhere.test.ts',
      run: (db, scope, ids) =>
        isActiveRepositoryOfAnotherInstallation(db, scope.installationId, ids.plain.githubRepoId),
      answers: () => ({ own: false, foreign: true }),
    },
  },
  'services/repository-statements.ts': {
    storedStates: scoped({
      takesIds: true,
      activeOnly: false,
      run: async (db, scope, ids) => {
        const states = await storedStates(db, scope.installationId, [
          { githubRepoId: ids.plain.githubRepoId, fullName: ids.plain.fullName },
        ]);
        return ownersOfGithubIds(db, [...states.keys()]);
      },
    }),
    writeChanged: scoped({
      takesIds: true,
      activeOnly: false,
      refusal: isUniqueViolation,
      run: async (db, scope, ids) => {
        await writeChanged(db, scope.installationId, [{ githubRepoId: ids.plain.githubRepoId, fullName: RENAMED }]);
        const rows = await db
          .selectFrom('repositories')
          .select('installation_id')
          .where('github_repo_id', '=', ids.plain.githubRepoId)
          .where('full_name', '=', RENAMED)
          .execute();
        return rows.map((row) => row.installation_id);
      },
    }),
  },
  'services/repository-transfer.ts': {
    releaseTransferred: {
      kind: 'by_design',
      reason:
        "a transfer moves a repository between two tenants of this server (E05-S09): GitHub lists it under the caller's installation, so the statement marks the other tenant's row removed, and sets nothing else",
      pinnedBy: 'services/repository-transfer-limits.test.ts',
      run: async (db, scope, ids) => {
        const before = await removedRepositories(db);
        await db
          .transaction()
          .execute((trx) => releaseTransferred(trx, scope.installationId, [ids.plain.githubRepoId], WHEN));
        return (await removedRepositories(db)).filter((githubRepoId) => !before.includes(githubRepoId));
      },
      answers: (_own, other) => ({ own: [], foreign: [other.plain.githubRepoId] }),
    },
  },
  'services/tenant-queries.ts': {
    findTenantRows: scoped({
      takesIds: true,
      activeOnly: true,
      run: async (db, scope, ids) => ownersOfTenantRows(await findTenantRows(db, scope, ids.plain.repositoryId)),
    }),
    findAdmittedTenantRows: scoped({
      takesIds: true,
      activeOnly: true,
      run: async (db, scope, ids) =>
        ownersOfTenantRows(await findAdmittedTenantRows(db, scope, ids.plain.repositoryId)),
    }),
    installationOfRepository: {
      kind: 'by_design',
      reason:
        'the resolver of a route keyed by a repository has only the repository to start from, so the function has no scope and answers with the installation id and nothing else (E11-S05)',
      pinnedBy: 'services/tenant-queries.test.ts',
      run: (db, _scope, ids) => installationOfRepository(db, ids.plain.repositoryId),
      answers: (own, other) => ({ own: own.installationId, foreign: other.installationId }),
    },
  },
  // The statements of the job queue (E07): the evaluation rows, the policy facts and the sweep's reads.
  ...JOB_TENANT_QUERIES,
};

/** What a call of a scoped query came to: the owners of the rows it read or changed, or that it was turned away. */
export type Outcome = { readonly kind: 'rows'; readonly owners: readonly number[] } | { readonly kind: 'refused' };

/**
 * Calls the query for `scope` with the ids of `ids`. An error that the entry names as its refusal is the outcome `refused`;
 * every other error is thrown, so a defect is never taken for a denial.
 */
export async function attempt(
  query: ScopedQuery,
  db: Kysely<Database>,
  scope: TenantScope,
  ids: TenantWorld,
): Promise<Outcome> {
  try {
    return { kind: 'rows', owners: await query.run(db, scope, ids) };
  } catch (error) {
    if (query.refusal?.(error) === true) {
      return { kind: 'refused' };
    }
    throw error;
  }
}
