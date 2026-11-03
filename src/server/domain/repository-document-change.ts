// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Role } from './authz.ts';
import { type AttachedDocumentScope, requiredRoleForRepository } from './repository-action.ts';

// Which role a change of the CLA a repository enforces needs (E14-S02). Pure, like the rule it is built on
// (`requiredRoleForRepository`, E14-S01): the caller reads the document that is attached, and the one to attach, and passes
// what they say.
//
//   attach a document     the role of the document's scope: org admin for one that covers the installation, admin of the
//                         repository for one scoped to it. A document that replaces another also takes the other away, so
//                         the role the other one needs is needed too: an admin of one repository cannot swap the CLA the
//                         organisation chose for a document of their own.
//   detach the document   the role of the document that is attached (org admin when it covers the installation or when none is
//                         attached, since the policy that applies is then the organisation's).

/** The repository the change is about: only its id matters, because a repo-scoped document is the repository's own or it is not. */
interface ChangedRepository {
  /** `repositories.id`. */
  readonly id: number;
}

/**
 * The role a person needs to leave the repository with `next` where it has `previous` (either may be null: nothing attached, and
 * a detach). An org admin satisfies every result (`satisfiesRole`), so the answer is `org_admin` as soon as one side of the
 * change is the organisation's, and `repo_admin` only when every document involved is the repository's own.
 */
export function requiredRoleForDocumentChange(
  repository: ChangedRepository,
  previous: AttachedDocumentScope | null,
  next: AttachedDocumentScope | null,
): Role {
  if (next === null) {
    return requiredRoleForRepository(repository, previous);
  }
  const joining = requiredRoleForRepository(repository, next);
  const leaving = previous === null ? 'repo_admin' : requiredRoleForRepository(repository, previous);
  return joining === 'org_admin' || leaving === 'org_admin' ? 'org_admin' : 'repo_admin';
}
