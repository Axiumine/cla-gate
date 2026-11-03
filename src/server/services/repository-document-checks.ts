// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Role } from '../domain/authz.ts';
import { type AttachedDocumentScope, satisfiesRole, scopeOfDocument } from '../domain/repository-action.ts';
import { requiredRoleForDocumentChange } from '../domain/repository-document-change.ts';
import { ClaRuleError } from './cla-rule-error.ts';
import type { LockedRepository } from './repository-document-lock-queries.ts';
import type { AttachableDocument } from './repository-document-queries.ts';

// The checks of a change of the CLA a repository enforces (E14-S02) that need the repository and the documents it involves, which
// repository-document-attach.ts reads under the lock of the repository. The role a change needs is the pure
// `requiredRoleForDocumentChange`; these are the rules that refuse the change by throwing the `ClaRuleError` the route answers.

/** Whether an attach may go on: the document is published, which is what makes it a CLA somebody can sign. @throws ClaRuleError `document_unpublished`. */
function requirePublished(document: AttachableDocument): void {
  if (document.activeVersionId === null) {
    throw new ClaRuleError('document_unpublished');
  }
}

/** The scope of the document a repository has or is given, null for none: what the role of a change is judged on. */
function scopeOf(document: { readonly repositoryId: number | null } | null): AttachedDocumentScope | null {
  return document === null ? null : scopeOfDocument(document.repositoryId);
}

/**
 * Whether the role the guard let the person in with is enough for the documents this change involves, which only the lock makes
 * certain.
 * @throws ClaRuleError `forbidden`.
 */
export function requireRole(role: Role, repository: LockedRepository, next: AttachableDocument | null): void {
  const required = requiredRoleForDocumentChange(repository, scopeOf(repository.document), scopeOf(next));
  if (!satisfiesRole(role, required)) {
    throw new ClaRuleError('forbidden');
  }
}

/**
 * The checks of a change that does change something, after the role: a detach needs enforcement to be off, an attach needs a
 * published document.
 * @throws ClaRuleError `repository_enabled`, `document_unpublished`.
 */
export function requireChangeable(repository: LockedRepository, next: AttachableDocument | null): void {
  if (next !== null) {
    requirePublished(next);
  } else if (repository.enabled) {
    throw new ClaRuleError('repository_enabled');
  }
}
