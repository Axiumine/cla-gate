// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { type ListedAccount, resolveAccount } from './allowlist-account.ts';
import { installationOf, judgedTarget } from './allowlist-entry-checks.ts';
import { insertAllowlistEntry } from './allowlist-entry-queries.ts';
import type { AllowlistDeps, AllowlistEntry, NewAllowlistEntry } from './allowlist-entry-types.ts';
import { sendAllowlistSweeps } from './allowlist-sweeps.ts';
import { appendAudit } from './audit.ts';
import { ClaRuleError } from './cla-rule-error.ts';
import type { JobEnqueuer } from './ports/jobs.ts';

// Adding an allowlist entry (E14-S06): one account exempted by its numeric GitHub id, for the whole installation or for one of its
// repositories. The account is resolved on GitHub first (allowlist-account.ts), outside any transaction. Then one transaction, under
// the lock of the repository row when the entry is for a repository (the lock of the CLA change and of the enforcement switch,
// so the role is judged against the document the repository enforces at that moment), stores the entry, appends the audit row
// `allowlist_entry.created` (ids only, no login) and sends the sweeps (allowlist-sweeps.ts), all or nothing.

/**
 * Everything adding the entry does in the transaction `trx`: the role again under the lock, the row, the audit row and the sweeps.
 * @throws ClaRuleError `forbidden`, `not_found`, `allowlist_entry_exists`; whatever the enqueuer rejects with.
 */
async function storeWithin(
  trx: Transaction<Database>,
  context: { readonly scope: TenantScope; readonly enqueuer: JobEnqueuer },
  request: NewAllowlistEntry,
  account: ListedAccount,
): Promise<AllowlistEntry> {
  const { scope, enqueuer } = context;
  const repositoryId = (await judgedTarget(trx, scope, request))?.id ?? null;
  const stored = await insertAllowlistEntry(trx, scope, {
    repositoryId,
    kind: request.entry.kind,
    githubId: account.githubId,
    loginSnapshot: account.loginSnapshot,
    createdBy: request.actor.id,
  });
  if (stored === undefined) {
    throw new ClaRuleError('allowlist_entry_exists');
  }
  const entry: AllowlistEntry = {
    id: stored.id,
    scope: request.target.scope,
    repositoryId,
    kind: request.entry.kind,
    githubId: account.githubId,
    loginSnapshot: account.loginSnapshot,
    createdBy: request.actor.githubId,
    createdAt: stored.createdAt,
  };
  await appendAudit(trx, {
    action: 'allowlist_entry.created',
    installationId: scope.installationId,
    actorGithubId: request.actor.githubId,
    subject: { type: 'allowlist_entry', id: entry.id },
    metadata: { scope: entry.scope, repository_id: repositoryId, kind: entry.kind, github_id: entry.githubId },
  });
  await sendAllowlistSweeps(trx, scope, enqueuer, { repositoryId, change: `created:${String(entry.id)}` });
  return entry;
}

/**
 * Adds an allowlist entry for an account of the tenant. The role is judged first, so a person without it learns nothing from GitHub;
 * the account is then looked up (a login on GitHub with the installation's token, the organisation from the installation row after the
 * App has shown it may list its members), and one transaction stores the entry by the numeric id GitHub answered with, appends
 * `allowlist_entry.created` and sends one `sweep-repository` job (reason `allowlist_changed`) per enforcing repository the entry
 * covers. A duplicate of the unique key stores nothing. A failure at any step, a throwing enqueuer included, rolls everything back.
 * @throws ClaRuleError `not_found`, `forbidden`, `github_account_not_found`, `kind_mismatch`, `no_organization`,
 * `members_permission_missing`, `allowlist_entry_exists`; GitHubRateLimitedError and GitHubUnavailableError for a lookup GitHub did
 * not answer. Anything the enqueuer rejects with.
 */
export async function createAllowlistEntry(
  deps: AllowlistDeps,
  scope: TenantScope,
  request: NewAllowlistEntry,
): Promise<AllowlistEntry> {
  const { db, github, enqueuer } = deps;
  const installation = await installationOf(db, scope);
  await judgedTarget(db, scope, request);
  const account = await resolveAccount(github, installation, request.entry);
  return db.transaction().execute((trx) => storeWithin(trx, { scope, enqueuer }, request, account));
}
