// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { judgedRemoval } from './allowlist-entry-checks.ts';
import { deleteAllowlistEntry, type FoundEntry, findAllowlistEntry } from './allowlist-entry-remove-queries.ts';
import type { AllowlistRemovalDeps, EntryRemoval } from './allowlist-entry-types.ts';
import { sendAllowlistSweeps } from './allowlist-sweeps.ts';
import { appendAudit } from './audit.ts';
import { ClaRuleError } from './cla-rule-error.ts';
import type { JobEnqueuer } from './ports/jobs.ts';

// Removing an allowlist entry (E14-S07): one transaction finds the entry of the tenant, judges the role against its scope (under the
// lock of the repository row when it is a repository's, the lock of the CLA change and of the enforcement switch), deletes the row
// for good, appends the audit row `allowlist_entry.deleted` (ids only, no login) and sends the sweeps of the repositories the entry
// covered (allowlist-sweeps.ts), all or nothing: taking an exemption away can turn a green check red.

/** The part of a removal that follows the role check, with the entry already found. */
interface Removal {
  readonly scope: TenantScope;
  readonly enqueuer: JobEnqueuer;
  readonly actorGithubId: EntryRemoval['actorGithubId'];
}

/**
 * Deletes the entry `entry` that was found and judged, appends the audit row and sends the sweeps, in the transaction `trx`.
 * @throws ClaRuleError `not_found` when a simultaneous removal deleted the entry between the find and this delete; whatever the
 * enqueuer rejects with.
 * @internal exported for the tests, which hand it an entry the database no longer holds
 */
export async function deleteFoundEntry(trx: Transaction<Database>, removal: Removal, entry: FoundEntry): Promise<void> {
  const { scope, enqueuer, actorGithubId } = removal;
  if (!(await deleteAllowlistEntry(trx, scope, entry.id))) {
    throw new ClaRuleError('not_found');
  }
  await appendAudit(trx, {
    action: 'allowlist_entry.deleted',
    installationId: scope.installationId,
    actorGithubId,
    subject: { type: 'allowlist_entry', id: entry.id },
    metadata: {
      scope: entry.repositoryId === null ? 'installation' : 'repository',
      repository_id: entry.repositoryId,
      kind: entry.kind,
      github_id: entry.githubId,
    },
  });
  await sendAllowlistSweeps(trx, scope, enqueuer, {
    repositoryId: entry.repositoryId,
    change: `deleted:${String(entry.id)}`,
  });
}

/**
 * Everything removing the entry does in the transaction `trx`: the find, the role under the lock, then the delete.
 * @throws ClaRuleError `not_found`, `forbidden`; whatever the enqueuer rejects with.
 */
async function removeWithin(trx: Transaction<Database>, removal: Removal, request: EntryRemoval): Promise<void> {
  const entry = await findAllowlistEntry(trx, removal.scope, request.entryId);
  if (entry === undefined) {
    throw new ClaRuleError('not_found');
  }
  await judgedRemoval(trx, removal.scope, { entry, role: request.role });
  await deleteFoundEntry(trx, removal, entry);
}

/**
 * Removes an allowlist entry of the tenant for good: the row is deleted, `allowlist_entry.deleted` is appended and one
 * `sweep-repository` job (reason `allowlist_changed`) is sent for each enforcing repository the entry covered. The role follows
 * the scope of the entry: an org admin for one that covers the installation, the role the repository-action rule asks for the
 * document the repository enforces for one of a repository. An entry the tenant does not have (another tenant's, unknown, or removed
 * already, also by a simultaneous call) is `not_found`. A failure at any step, a throwing enqueuer included, rolls everything back.
 * @throws ClaRuleError `not_found`, `forbidden`. Anything the enqueuer rejects with.
 */
export async function removeAllowlistEntry(
  deps: AllowlistRemovalDeps,
  scope: TenantScope,
  request: EntryRemoval,
): Promise<void> {
  const { db, enqueuer } = deps;
  await db
    .transaction()
    .execute((trx) => removeWithin(trx, { scope, enqueuer, actorGithubId: request.actorGithubId }, request));
}
