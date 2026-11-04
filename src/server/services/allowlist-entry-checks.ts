// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import type { Role } from '../domain/authz.ts';
import { satisfiesRole } from '../domain/repository-action.ts';
import type { FoundEntry } from './allowlist-entry-remove-queries.ts';
import type { NewAllowlistEntry } from './allowlist-entry-types.ts';
import { ClaRuleError } from './cla-rule-error.ts';
import type { InstallationRow } from './installation-state.ts';
import {
  findRepositoryWithDocument,
  type LockedRepository,
  lockRepositoryForDocumentChange,
} from './repository-document-lock-queries.ts';
import { requireActionRole } from './repository-enablement-checks.ts';
import { findTenantRows } from './tenant-queries.ts';

// The checks of the allowlist (E14-S06, E14-S07) that read the tenant: who may add, list or remove entries for a target, judged
// against the document the repository enforces at the moment (under its lock inside the transaction when the call changes
// something), and the installation row itself.

/**
 * Whether the role the guard let the person in with is an org admin's: the role the entries that cover the installation need.
 * @throws ClaRuleError `forbidden`.
 */
export function requireOrgAdmin(role: Role): void {
  if (!satisfiesRole(role, 'org_admin')) {
    throw new ClaRuleError('forbidden');
  }
}

/**
 * Judges the role against the target and returns the repository it names, locked when `db` is a transaction (null for the whole
 * installation). The target of the installation needs an org admin. The target of a repository needs what the repository-action rule
 * asks for the document it enforces: an org admin for none or the organisation's, an admin of the repository for its own.
 * @throws ClaRuleError `forbidden`, or `not_found` for a repository that left the tenant since the guard read it.
 */
export async function judgedTarget(
  db: Kysely<Database>,
  scope: TenantScope,
  request: NewAllowlistEntry,
): Promise<LockedRepository | null> {
  const { target, role } = request;
  if (target.scope === 'installation') {
    requireOrgAdmin(role);
    return null;
  }
  const repository = await lockRepositoryForDocumentChange(db, scope, target.repositoryId);
  if (repository === null) {
    throw new ClaRuleError('not_found');
  }
  requireActionRole(role, repository);
  return repository;
}

/** The installation row, the tenant itself. @throws ClaRuleError `not_found` when it is gone. */
export async function installationOf(db: Kysely<Database>, scope: TenantScope): Promise<InstallationRow> {
  const rows = await findTenantRows(db, scope, null);
  if (rows === null) {
    throw new ClaRuleError('not_found');
  }
  return rows.installation;
}

/**
 * Judges the role against the repository whose list is read: the repository-action rule on the document it enforces now, read
 * without a lock because the call changes nothing.
 * @throws ClaRuleError `forbidden`, or `not_found` for a repository that left the tenant since the guard read it.
 */
export async function judgedRepositoryRead(
  db: Kysely<Database>,
  scope: TenantScope,
  read: { readonly repositoryId: number; readonly role: Role },
): Promise<void> {
  const repository = await findRepositoryWithDocument(db, scope, read.repositoryId);
  if (repository === null) {
    throw new ClaRuleError('not_found');
  }
  requireActionRole(read.role, repository);
}

/**
 * Judges the role against the entry to remove, under the lock of its repository's row when `db` is a transaction: an entry that
 * covers the installation needs an org admin; one of a repository needs what the repository-action rule asks for the document it
 * enforces now. An entry of a repository that has left the installation can only be removed by an org admin, because the permission
 * of a person on that repository cannot be checked.
 * @throws ClaRuleError `forbidden`.
 */
export async function judgedRemoval(
  db: Kysely<Database>,
  scope: TenantScope,
  removal: { readonly entry: FoundEntry; readonly role: Role },
): Promise<void> {
  const { entry, role } = removal;
  // One await in every case (an entry of the installation has no repository to lock), so the code after it runs as often as it is reached.
  const repository = await (entry.repositoryId === null
    ? null
    : lockRepositoryForDocumentChange(db, scope, entry.repositoryId));
  if (repository === null) {
    requireOrgAdmin(role);
    return;
  }
  requireActionRole(role, repository);
}
