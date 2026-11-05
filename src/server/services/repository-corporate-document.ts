// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely, Transaction } from 'kysely';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { appendAudit } from './audit.ts';
import { findCorporateChoice, lockCorporateRepository, setCorporateDocument } from './corporate-repository-queries.ts';
import { CorporateRuleError } from './corporate-rule-error.ts';

// Choosing the corporate CLA of a repository and removing the choice (E21-S02): the one mutation that moves
// `repositories.corporate_document_id`. One transaction under the lock of the repository row, so the check, the pointer and the audit
// row are decided together and either all happen or none does. A repository with no corporate document accepts individual
// signatures only. Nothing is sent to the queue: the evaluation of a pull request does not read corporate approvals before E21-S05.

/** One request to change the corporate CLA of a repository. */
export interface CorporateDocumentChange {
  /** `repositories.id` of the repository, as the tenant guard resolved it. */
  readonly repositoryId: number;
  readonly actorGithubId: GithubId;
  /** `cla_documents.id` to take, or `null` to remove the choice. */
  readonly documentId: number | null;
}

/** The answer: the corporate document the repository has now, and whether the call changed it. */
export interface CorporateDocumentChanged {
  readonly documentId: number | null;
  readonly changed: boolean;
}

/**
 * Everything a change does in the transaction `trx`: the checks, then the pointer and the audit row.
 * @throws CorporateRuleError `not_found`, `document_not_corporate`.
 */
async function changeWithin(
  trx: Transaction<Database>,
  scope: TenantScope,
  change: CorporateDocumentChange,
): Promise<CorporateDocumentChanged> {
  const repository = await lockCorporateRepository(trx, scope, change.repositoryId);
  if (repository === null) {
    throw new CorporateRuleError('not_found');
  }
  const next =
    change.documentId === null ? null : await findCorporateChoice(trx, scope, repository.id, change.documentId);
  if (change.documentId !== null && next === null) {
    throw new CorporateRuleError('document_not_corporate');
  }
  if (repository.corporateDocumentId === next) {
    return { documentId: next, changed: false };
  }
  await setCorporateDocument(trx, scope, repository.id, next);
  await appendAudit(trx, {
    action: 'repository.corporate_document_set',
    installationId: scope.installationId,
    actorGithubId: change.actorGithubId,
    subject: { type: 'repository', id: repository.githubRepoId },
    metadata: {
      repository_id: repository.id,
      document_id: next,
      previous_document_id: repository.corporateDocumentId,
    },
  });
  return { documentId: next, changed: true };
}

/**
 * Takes a corporate document for a repository of the tenant, replaces the one it has, or removes it (`documentId` null). One
 * transaction under the lock of the repository row: the second of two simultaneous changes waits, reads what the first left and is
 * judged against it. A change appends the audit row `repository.corporate_document_set` (ids only, `null` for none); a call that asks
 * for what already is writes nothing. A failure at any step rolls everything back.
 * @throws CorporateRuleError `not_found` (the repository left the tenant since the guard read it), `document_not_corporate` for a
 * document the repository may not take, whatever the reason: unknown, another tenant's, another repository's, or not corporate.
 */
export function changeCorporateDocument(
  db: Kysely<Database>,
  scope: TenantScope,
  change: CorporateDocumentChange,
): Promise<CorporateDocumentChanged> {
  return db.transaction().execute((trx) => changeWithin(trx, scope, change));
}
