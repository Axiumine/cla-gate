// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import type { Role } from '../domain/authz.ts';
import { type BadgeSnippet, badgeSnippet } from '../domain/badge-snippet.ts';
import { ClaRuleError } from './cla-rule-error.ts';
import { isPublicVerificationOn } from './public-verification-queries.ts';
import { findRepositoryWithDocument } from './repository-document-lock-queries.ts';
import { requireActionRole } from './repository-enablement-checks.ts';

// The snippet of the README badge of a repository (E22-S03): a read for the people who may change the opt-in, that writes nothing and
// makes no call to GitHub.

/** One request for the snippet of a repository of the tenant. */
export interface BadgeSnippetRequest {
  /** `repositories.id`, as the tenant guard resolved it. */
  readonly repositoryId: number;
  /** The role the guard let the person in with. */
  readonly role: Role;
  /** `PUBLIC_BASE_URL`: the origin the badge and the sign page are on. */
  readonly publicBaseUrl: string;
}

/**
 * The Markdown and HTML of the project badge of a repository of the tenant, for the maintainers who may change its opt-in: the role
 * is judged by the same repository-action rule as the opt-in itself, on the document the repository enforces. While the opt-in is
 * off there is no badge to show (the badge of a repository that did not opt in is a 404), so the answer is the rule
 * `public_verification_disabled`, and a role that is too low is told `forbidden` before it is told anything about the opt-in.
 * @throws ClaRuleError `not_found` (the repository left the tenant since the guard read it), `forbidden` (the role is too low for
 * the document the repository enforces), `public_verification_disabled`.
 */
export async function readBadgeSnippet(
  db: Kysely<Database>,
  scope: TenantScope,
  request: BadgeSnippetRequest,
): Promise<BadgeSnippet> {
  const repository = await findRepositoryWithDocument(db, scope, request.repositoryId);
  if (repository === null) {
    throw new ClaRuleError('not_found');
  }
  requireActionRole(request.role, repository);
  if (!(await isPublicVerificationOn(db, scope, repository.id))) {
    throw new ClaRuleError('public_verification_disabled');
  }
  return badgeSnippet(request.publicBaseUrl, repository.githubRepoId);
}
