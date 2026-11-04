// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { satisfiesRole } from '../domain/repository-action.ts';
import type { NewAllowlistEntry } from './allowlist-entry-types.ts';
import { ClaRuleError } from './cla-rule-error.ts';
import type { InstallationRow } from './installation-state.ts';
import { type LockedRepository, lockRepositoryForDocumentChange } from './repository-document-lock-queries.ts';
import { requireActionRole } from './repository-enablement-checks.ts';
import { findTenantRows } from './tenant-queries.ts';

// The checks of adding an allowlist entry (E14-S06) that read the tenant: who may add an entry for the target, judged against the
// document the repository enforces at the moment (under its lock inside the transaction), and the installation row itself.

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
    if (!satisfiesRole(role, 'org_admin')) {
      throw new ClaRuleError('forbidden');
    }
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
