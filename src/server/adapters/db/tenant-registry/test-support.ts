// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { parseGithubId } from '../../../../shared/github-id.ts';
import { forgetAdminSeen, recordAdminSeen, wasAdminSeenSince } from '../../../services/admin-ledger-queries.ts';
import { auditLogRows, listAuditLog } from '../../../services/audit-log-queries.ts';
import { findDocumentPlacement, findSignaturePlacement } from '../../../services/document-placement.ts';
import { listInstallationsForOperator } from '../../../services/installation-operator.ts';
import { listRepoAdminCandidates } from '../../../services/repo-admin-candidates.ts';
import {
  findActiveRepositoryByGithubId,
  findRepositoryByGithubId,
  isActiveRepositoryOfAnotherInstallation,
  isRepositoryEnabled,
  listActiveRepositoryIds,
  listEnabledRepositories,
  markRepositoriesRemoved,
  renameActiveRepository,
} from '../../../services/repository-queries.ts';
import { storedStates, writeChanged } from '../../../services/repository-statements.ts';
import { releaseTransferred } from '../../../services/repository-transfer.ts';
import { eraseSigner, erasureCounts } from '../../../services/signer-erasure.ts';
import {
  findAdmittedTenantRows,
  findTenantRows,
  installationOfRepository,
  type TenantRows,
} from '../../../services/tenant-queries.ts';
import type { Database } from '../schema.ts';
import { EXPORT_TENANT_QUERIES } from '../tenant-export-fixture/test-support.ts';
import type { TenantWorld } from '../tenant-fixture/test-support.ts';
import { JOB_TENANT_QUERIES } from '../tenant-jobs-fixture/test-support.ts';
import { LINK_TENANT_QUERIES } from '../tenant-links-fixture/test-support.ts';
import {
  ledgerOwnersOf,
  ownersOfAuditRows,
  ownersOfDocuments,
  ownersOfGithubIds,
  ownersOfRepositories,
  ownersOfSignatures,
  removedRepositories,
} from '../tenant-owners/test-support.ts';
import { ALLOWLIST_TENANT_QUERIES } from '../tenant-registry-allowlist/test-support.ts';
import { ATTACH_QUERIES, LOCK_QUERIES } from '../tenant-registry-attach/test-support.ts';
import { DOCUMENT_READS, DOCUMENT_WRITES } from '../tenant-registry-documents/test-support.ts';
import { DRAFT_READS, DRAFT_WRITES } from '../tenant-registry-drafts/test-support.ts';
import { ENABLED_WRITES } from '../tenant-registry-enabled/test-support.ts';
import { COUNT_READS, LISTING_READS } from '../tenant-registry-listing/test-support.ts';
import { SCOPE_QUERIES } from '../tenant-registry-scope/test-support.ts';
import {
  ENFORCING_READS,
  HISTORY_READS,
  VERSION_READS,
  VERSION_WRITES,
} from '../tenant-registry-versions/test-support.ts';
import type { TenantScope } from '../tenant-scope.ts';
import { SIGN_TENANT_QUERIES } from '../tenant-sign-fixture/test-support.ts';

// The registry of the tenant data access (E11-S06). `TENANT_MODULES` lists the files that run a statement over a tenant
// table; `TENANT_QUERIES` has an entry for every function they export, with the factory of its fixture arguments: how to
// call it for a tenant and for the ids of a tenant. The generated test calls each entry for tenant 1 with tenant 1's ids and
// with tenant 2's, and a file that touches a tenant table without being listed, or a function that is listed nowhere, fails
// the build (tenant-modules.test.ts), so a query cannot ship without the cross-tenant check.

/** The files that run a statement over a tenant table, relative to `src/server`. */
export const TENANT_MODULES = [
  'adapters/db/pr-evaluation-links.ts',
  'adapters/db/tenant-scope.ts',
  'services/admin-ledger-queries.ts',
  'services/allowlist-entry-list-queries.ts',
  'services/allowlist-entry-queries.ts',
  'services/allowlist-entry-remove-queries.ts',
  'services/allowlist-sweeps.ts',
  'services/audit-log-queries.ts',
  'services/close-pr/close-heads.ts',
  'services/close-pr/close-rows.ts',
  'services/cla-document-queries.ts',
  'services/cla-document-writes.ts',
  'services/cla-draft-queries.ts',
  'services/cla-draft-writes.ts',
  'services/cla-enforcing-queries.ts',
  'services/cla-history-queries.ts',
  'services/cla-version-queries.ts',
  'services/cla-version-writes.ts',
  'services/document-placement.ts',
  'services/evaluate-pr/evaluation-rows.ts',
  'services/evaluate-pr/policy-facts.ts',
  'services/evaluate-pr/signature-facts.ts',
  'services/export/own-data-queries.ts',
  'services/export/own-signatures-query.ts',
  'services/export/signature-queries.ts',
  'services/failing-evaluation-queries.ts',
  'services/finalise/finalise-rows.ts',
  'services/installation-operator.ts',
  'services/own-signatures-queries.ts',
  'services/repo-admin-candidates.ts',
  'services/repository-count-queries.ts',
  'services/repository-document-lock-queries.ts',
  'services/repository-document-queries.ts',
  'services/repository-enabled.ts',
  'services/repository-list-queries.ts',
  'services/repository-queries.ts',
  'services/repository-statements.ts',
  'services/repository-transfer.ts',
  'services/sign-context-queries.ts',
  'services/sign-record-queries.ts',
  'services/signer-erasure.ts',
  'services/sweep/sweep-rows.ts',
  'services/tenant-queries.ts',
] as const;

/** The one file that writes `audit_log`: rows are appended in the transaction of the change they record, naming the installation the entry carries (E04-S09); nothing else inserts them, and reads of the table belong to a tenant module. */
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
  /**
   * Puts the world of the matrix in the state the entry needs, for both tenants, before the matrix takes its checksums (a
   * repository that enforces a document, a second version to point at). Without it an entry has only the rows `twoTenants` stores.
   */
  readonly arrange?: (db: Kysely<Database>, tenants: readonly TenantWorld[]) => Promise<void>;
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

const RENAMED = 'renamed/by-test';
const WHEN = new Date('2026-07-01T00:00:00Z');

const scoped = (
  options: Pick<ScopedQuery, 'takesIds' | 'activeOnly' | 'run'> & { readonly refusal?: Refusal },
): ScopedQuery => ({ kind: 'scoped', ...options });

/** Every exported function of every module of {@link TENANT_MODULES}, by module and name. */
export const TENANT_QUERIES: Readonly<Record<string, Readonly<Record<string, TenantQuery>>>> = {
  'adapters/db/tenant-scope.ts': SCOPE_QUERIES,
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
  'services/audit-log-queries.ts': {
    // The audit rows the seed gives each tenant name the tenant's own plain repository as their subject, so the filter on it
    // finds the tenant's row with its own ids and nothing with another tenant's.
    auditLogRows: scoped({
      takesIds: true,
      activeOnly: false,
      run: async (db, scope, ids) => {
        const rows = await auditLogRows(db, scope, {
          subjectType: 'repository',
          subjectId: ids.plain.repositoryId,
          limit: 10,
        }).execute();
        return ownersOfAuditRows(
          db,
          rows.map((row) => row.id),
        );
      },
    }),
    listAuditLog: scoped({
      takesIds: true,
      activeOnly: false,
      run: async (db, scope, ids) => {
        const page = await listAuditLog(db, scope, {
          subjectType: 'repository',
          subjectId: ids.plain.repositoryId,
          limit: 10,
        });
        return ownersOfAuditRows(
          db,
          page.items.map((item) => item.id),
        );
      },
    }),
  },
  'services/cla-document-queries.ts': DOCUMENT_READS,
  'services/cla-document-writes.ts': DOCUMENT_WRITES,
  'services/cla-draft-queries.ts': DRAFT_READS,
  'services/cla-draft-writes.ts': DRAFT_WRITES,
  'services/cla-enforcing-queries.ts': ENFORCING_READS,
  'services/cla-history-queries.ts': HISTORY_READS,
  'services/cla-version-queries.ts': VERSION_READS,
  'services/cla-version-writes.ts': VERSION_WRITES,
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
  'services/repository-enabled.ts': ENABLED_WRITES,
  'services/repository-count-queries.ts': COUNT_READS,
  'services/repository-document-lock-queries.ts': LOCK_QUERIES,
  'services/repository-document-queries.ts': ATTACH_QUERIES,
  'services/repository-list-queries.ts': LISTING_READS,
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
    isRepositoryEnabled: scoped({
      takesIds: true,
      activeOnly: true,
      // The fixture enables the scoped repository of each tenant, so a statement that strayed would find the other tenant's row on.
      run: async (db, scope, ids) =>
        (await isRepositoryEnabled(db, scope.installationId, ids.scoped.repositoryId))
          ? ownersOfRepositories(db, [ids.scoped.repositoryId])
          : [],
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
  'services/signer-erasure.ts': {
    // The person is named by a GitHub id, which belongs to no tenant, so there is no other tenant's id to hand either
    // function; what they do for a person who signed in two tenants is shown in services/signer-erasure.test.ts and
    // adapters/http/erasure-tenants.test.ts. The seed gives each tenant its own signer, so the count finds that signer's
    // signature (as many owners as signatures it counted) and the erasure leaves its audit row.
    erasureCounts: scoped({
      takesIds: false,
      activeOnly: false,
      run: async (db, scope, ids) => {
        const counts = await erasureCounts(db, scope, ids.signer.githubId);
        return (await ownersOfSignatures(db, [ids.signatureId])).slice(0, counts.signatures);
      },
    }),
    eraseSigner: scoped({
      takesIds: false,
      activeOnly: false,
      run: async (db, scope, ids) => {
        await eraseSigner(db, scope, { githubUserId: ids.signer.githubId, expectedRows: 1, actor: parseGithubId(1) });
        const rows = await db
          .selectFrom('audit_log')
          .select('id')
          .where('action', '=', 'signer_pii.erased')
          .where('subject_id', '=', ids.signer.githubId)
          .execute();
        return ownersOfAuditRows(
          db,
          rows.map((row) => row.id),
        );
      },
    }),
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
  // The statements of the exports (E16-S03, E16-S06): the signatures of a document, and a person's own data.
  ...EXPORT_TENANT_QUERIES,
  // The statements of the reporter over the evaluation rows (E09-S04).
  ...LINK_TENANT_QUERIES,
  // The statements of the sign page context (E13-S02).
  ...SIGN_TENANT_QUERIES,
  ...ALLOWLIST_TENANT_QUERIES,
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
