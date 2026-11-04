// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Role } from '../domain/authz.ts';
import { requiredRoleForRepository, satisfiesRole, scopeOfAttached } from '../domain/repository-action.ts';
import { ClaRuleError } from './cla-rule-error.ts';
import type { LockedRepository } from './repository-document-lock-queries.ts';

// The checks of turning enforcement on or off for a repository (E14-S03, E14-S04) that need the repository and the document it
// enforces, which the caller reads under the lock of the repository. The rule behind the role is the pure
// `requiredRoleForRepository` (E14-S01); these are the checks that refuse the call by throwing the `ClaRuleError` the route answers.

/** What the client is told when there is nothing to enforce: the fix, since the status text alone does not name it. */
const NO_ACTIVE_CLA_HINT =
  'Attach a CLA document to this repository and publish a version of it first, then enable the repository.';

/**
 * Whether the role the guard let the person in with is enough for this repository, by the repository-action rule: the policy is
 * the scope of the document it enforces (none, or the organisation's, needs an org admin; the repository's own needs an admin of
 * it). The guard let in an admin of the repository or of the organisation before the document was read under the lock.
 * @throws ClaRuleError `forbidden`.
 */
export function requireActionRole(role: Role, repository: LockedRepository): void {
  const required = requiredRoleForRepository(repository, scopeOfAttached(repository.document));
  if (!satisfiesRole(role, required)) {
    throw new ClaRuleError('forbidden');
  }
}

/**
 * Whether the repository has a CLA to enforce: a document is attached and it has a published version.
 * @throws ClaRuleError `no_active_cla`, with the hint that names the fix.
 */
export function requireActiveCla(repository: LockedRepository): void {
  if ((repository.document?.activeVersionId ?? null) === null) {
    throw new ClaRuleError('no_active_cla', { hint: NO_ACTIVE_CLA_HINT });
  }
}
