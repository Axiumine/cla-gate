// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely, Transaction } from 'kysely';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import type { Role } from '../domain/authz.ts';
import { ClaRuleError } from './cla-rule-error.ts';
import type { JobEnqueuer } from './ports/jobs.ts';
import { requireChangeable, requireRole } from './repository-document-checks.ts';
import { type LockedRepository, lockRepositoryForDocumentChange } from './repository-document-lock-queries.ts';
import { type AttachableDocument, findAttachableDocument } from './repository-document-queries.ts';
import { recordChange } from './repository-document-record.ts';

// Attaching a CLA document to a repository and detaching it (E14-S02): the one mutation that moves `repositories.cla_document_id`.
// It is one transaction under the lock of the repository row, so the checks, the pointer, the audit row and the sweep are decided
// together and either all happen or none does. The statements are in repository-document-lock-queries.ts and
// repository-document-queries.ts, the checks in repository-document-checks.ts (the role is the pure `requiredRoleForDocumentChange`),
// and the writes, with the sweep of E07-S09 (`enqueueSweepRepository`), in repository-document-record.ts.

/** One request to change the CLA a repository enforces. */
export interface DocumentChange {
  /** `repositories.id` of the repository, as the tenant guard resolved it. */
  readonly repositoryId: number;
  /** The role the guard let the person in with. */
  readonly role: Role;
  readonly actorGithubId: GithubId;
  /** `cla_documents.id` to attach, or null to detach. */
  readonly documentId: number | null;
}

/** The answer: the document the repository enforces now, and whether the call changed it. */
export interface DocumentChanged {
  readonly documentId: number | null;
  readonly changed: boolean;
}

/**
 * The document to attach, or null for a detach.
 * @throws ClaRuleError `document_not_attachable` for a document the repository may not enforce, whatever the reason.
 */
async function documentToAttach(
  trx: Transaction<Database>,
  scope: TenantScope,
  repository: LockedRepository,
  documentId: number | null,
): Promise<AttachableDocument | null> {
  if (documentId === null) {
    return null;
  }
  const document = await findAttachableDocument(trx, scope, repository.id, documentId);
  if (document === null) {
    throw new ClaRuleError('document_not_attachable');
  }
  return document;
}

/**
 * Everything a change does in the transaction `trx`: the checks, then the writes.
 * @throws ClaRuleError a rule the change breaks; whatever the enqueuer rejects with.
 */
async function changeWithin(
  trx: Transaction<Database>,
  scope: TenantScope,
  enqueuer: JobEnqueuer,
  change: DocumentChange,
): Promise<DocumentChanged> {
  const repository = await lockRepositoryForDocumentChange(trx, scope, change.repositoryId);
  if (repository === null) {
    throw new ClaRuleError('not_found');
  }
  const next = await documentToAttach(trx, scope, repository, change.documentId);
  requireRole(change.role, repository, next);
  const nextId = next?.id ?? null;
  if ((repository.document?.id ?? null) === nextId) {
    return { documentId: nextId, changed: false };
  }
  requireChangeable(repository, next);
  await recordChange(trx, scope, enqueuer, { repository, next, actorGithubId: change.actorGithubId });
  return { documentId: nextId, changed: true };
}

/**
 * Attaches a document to a repository of the tenant, replaces the one it has, or detaches it (`documentId` null). One transaction
 * under the lock of the repository row: the second of two simultaneous changes waits, reads what the first left and is judged
 * against it. A change appends the audit row `repository.cla_document_attached` or `repository.cla_document_detached` (ids only)
 * and, when the repository enforces the CLA, sends one `sweep-repository` job with the reason `cla_document_changed`: the
 * signatures made under the previous document no longer cover the repository, so its open pull requests are evaluated again. A
 * call that asks for what already is writes nothing and sends nothing. A failure at any step, a throwing enqueuer included,
 * rolls everything back.
 * @throws ClaRuleError `not_found` (the repository left the tenant since the guard read it), `document_not_attachable`,
 * `forbidden` (the role is too low for the documents the change involves), `document_unpublished`, `repository_enabled`.
 * Anything the enqueuer rejects with.
 */
export function changeRepositoryDocument(
  db: Kysely<Database>,
  scope: TenantScope,
  enqueuer: JobEnqueuer,
  change: DocumentChange,
): Promise<DocumentChanged> {
  return db.transaction().execute((trx) => changeWithin(trx, scope, enqueuer, change));
}
