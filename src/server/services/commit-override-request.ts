// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { normaliseRationale } from '../../shared/cla-version.ts';
import { normaliseCommitSha } from '../../shared/commit-override.ts';
import type { GithubId } from '../../shared/github-id.ts';
import type { Role } from '../domain/authz.ts';
import { ClaRuleError } from './cla-rule-error.ts';
import type { LockedRepository } from './repository-document-lock-queries.ts';

// The request to record a per-commit override (E15-S05) as the route reads it, and the two checks that need nothing but the request and
// the repository: the commit id and the reason cleaned, and the repository on. The role, GitHub and the transaction are in
// commit-override-create.ts.

/** One request to record an override, as the route read it: the commit and the reason are what the person typed. */
export interface NewCommitOverride {
  /** `repositories.id`. */
  readonly repositoryId: number;
  /** The role the guard let the person in with. */
  readonly role: Role;
  /** `id` is `users.id` (stored as `created_by`), `githubId` the identity the audit row and the answer name, `login` its display snapshot. */
  readonly actor: { readonly id: number; readonly githubId: GithubId; readonly login: string };
  readonly commitSha: string;
  readonly reason: string;
}

/** The override that was recorded. */
export interface RecordedCommitOverride {
  readonly id: number;
  readonly repositoryId: number;
  readonly commitSha: string;
  readonly reason: string;
  readonly createdBy: { readonly githubId: GithubId; readonly login: string };
  readonly createdAt: Date;
}

/** The request cleaned: the full SHA in lower case and the reason as it is stored. */
export interface CleanedOverride {
  readonly commitSha: string;
  readonly reason: string;
}

/**
 * The request as it is stored. The reason is cleaned like any maintainer's note (line endings, ends trimmed, 1 to 2,000 characters,
 * no control characters); a hostile text (markup, a formula, a mention) is a valid reason and is kept as it is, since every output
 * escapes it for its own context.
 * @throws ClaRuleError `invalid_commit_sha`, `invalid_reason`.
 */
export function cleaned(request: NewCommitOverride): CleanedOverride {
  const commitSha = normaliseCommitSha(request.commitSha);
  if (commitSha === null) {
    throw new ClaRuleError('invalid_commit_sha');
  }
  const reason = normaliseRationale(request.reason);
  if (reason === null) {
    throw new ClaRuleError('invalid_reason');
  }
  return { commitSha, reason };
}

/**
 * Whether the repository enforces anything: a disabled repository evaluates nothing, so an override for it is turned away.
 * @throws ClaRuleError `repository_disabled`.
 */
export function requireEnabled(repository: LockedRepository): void {
  if (!repository.enabled) {
    throw new ClaRuleError('repository_disabled');
  }
}
