// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import type { Role } from '../domain/authz.ts';
import { appendAudit } from './audit.ts';
import { ClaRuleError } from './cla-rule-error.ts';
import { lockRepositoryForDocumentChange } from './repository-document-lock-queries.ts';
import { requireActionRole } from './repository-enablement-checks.ts';

// The opt-in of a repository to the public signature check (E22-S02): a setting of the repository, changed by the people who may
// change its other settings, and audited. It reads and writes nothing about signatures; the check itself is public-verification.ts.

/** One request to turn the public signature check on or off for a repository of the tenant. */
export interface PublicVerificationChange {
  /** `repositories.id` of the repository, as the tenant guard resolved it. */
  readonly repositoryId: number;
  /** The role the guard let the person in with. */
  readonly role: Role;
  /** The person who asked: the audit row names them by their numeric GitHub id. */
  readonly actorGithubId: GithubId;
  /** The value `repositories.public_verification` takes. */
  readonly enabled: boolean;
}

/** The answer: whether the check is on now, and whether the call is the one that changed it. */
export interface PublicVerificationChanged {
  readonly enabled: boolean;
  readonly changed: boolean;
}

/**
 * Sets `repositories.public_verification` of a repository of the tenant and appends the audit row
 * `repository.public_verification_changed` (subject the repository's GitHub id, metadata `repository_id` and `enabled`: ids and a
 * flag, no name and no login), in one transaction under the lock of the repository row, the one the change of the CLA document and
 * the switch of enforcement take. The role is judged by the repository-action rule on the document read under that lock, so the
 * setting needs the same role as the repository's other settings. The update is conditional on the current value, so a call that
 * finds the flag at that value already (the second of two simultaneous ones, say) changes and audits nothing and answers
 * `changed: false`. A failure at any step rolls everything back. No call is made to GitHub.
 * @throws ClaRuleError `not_found` (the repository left the tenant since the guard read it), `forbidden` (the role is too low for
 * the document the repository enforces).
 */
export function setPublicVerification(
  db: Kysely<Database>,
  scope: TenantScope,
  change: PublicVerificationChange,
): Promise<PublicVerificationChanged> {
  return db.transaction().execute(async (trx) => {
    const repository = await lockRepositoryForDocumentChange(trx, scope, change.repositoryId);
    if (repository === null) {
      throw new ClaRuleError('not_found');
    }
    requireActionRole(change.role, repository);
    const updated = await trx
      .updateTable('repositories')
      .set({ public_verification: change.enabled, updated_at: sql`now()` })
      .where('installation_id', '=', scope.installationId)
      .where('id', '=', repository.id)
      .where('public_verification', '=', !change.enabled)
      .returning('id')
      .executeTakeFirst();
    if (updated === undefined) {
      return { enabled: change.enabled, changed: false };
    }
    await appendAudit(trx, {
      action: 'repository.public_verification_changed',
      installationId: scope.installationId,
      actorGithubId: change.actorGithubId,
      subject: { type: 'repository', id: repository.githubRepoId },
      metadata: { repository_id: repository.id, enabled: change.enabled },
    });
    return { enabled: change.enabled, changed: true };
  });
}
