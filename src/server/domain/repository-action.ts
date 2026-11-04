// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Role } from './authz.ts';

// The repository-action rule (E14-S01), defined once: which role a person needs to act on one repository (attach or detach its
// CLA document, enable or disable it, edit its allowlist, record an override). Pure: the caller reads the repository and the
// document it enforces and passes what they say; nothing is read from GitHub, the database or the clock here. E14-S02 to
// E14-S07 and E15 take their requirement from it, and the repository list shows its answer for the viewer as `canAdminister`.
//
//   no document, or one that covers the installation   org admin
//   a document scoped to this very repository          admin of the repository (an org admin passes too)

/** The repository an action is about: only its id matters, because a repo-scoped document is the repository's own or it is not. */
interface ActedOnRepository {
  /** `repositories.id`. */
  readonly id: number;
}

/**
 * The CLA document attached to the repository, as far as the rule needs to know: whom it covers. A document scoped to a
 * repository carries that repository's `repositories.id`.
 */
export type AttachedDocumentScope =
  | { readonly scope: 'installation' }
  | { readonly scope: 'repository'; readonly repositoryId: number };

/**
 * The scope of a document by the repository it is stored for (`cla_documents.repository_id`, null when it covers the whole
 * installation): the form the rule takes it in.
 */
function scopeOfDocument(repositoryId: number | null): AttachedDocumentScope {
  return repositoryId === null ? { scope: 'installation' } : { scope: 'repository', repositoryId };
}

/** The scope of the document a repository enforces (null when it has none), in the form the rule takes it in. */
export function scopeOfAttached(
  document: { readonly repositoryId: number | null } | null,
): AttachedDocumentScope | null {
  return document === null ? null : scopeOfDocument(document.repositoryId);
}

/**
 * The role an action on `repository` needs, given the document it enforces (null when none is attached): `org_admin` when
 * the document covers the whole installation or there is none, since the policy that applies is then the organisation's;
 * `repo_admin` when it is scoped to this very repository. A document scoped to another repository is never attached (E14-S02
 * refuses it, and the database ties a document to its installation); should one be found, the rule falls back to the
 * stricter role and does not hand the repository to a person who administers a different one.
 */
export function requiredRoleForRepository(repository: ActedOnRepository, document: AttachedDocumentScope | null): Role {
  return document?.scope === 'repository' && document.repositoryId === repository.id ? 'repo_admin' : 'org_admin';
}

/**
 * Whether a person with `held` can act where `required` is needed: an org admin always can, an admin of a repository only
 * where the repository's own document makes `repo_admin` the requirement.
 */
export function satisfiesRole(held: Role, required: Role): boolean {
  return held === 'org_admin' || required === 'repo_admin';
}
