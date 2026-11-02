// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// E08-S01: the closed lists of the PR evaluation vocabulary. They live in src/shared because the pure engine
// (src/server/domain/evaluation) names these codes and the stored-details schema (pr-evaluation-details.ts) validates
// them, and neither side may import the other. Every list is a tuple, so its members are also a type.

/** Why a pull request fails. A closed list: a new reason is a new member and a new story. */
export const FAILURE_CODES = [
  'no_active_cla',
  'unsigned_contributor',
  'bot_not_allowlisted',
  'unlinked_identity',
  'commit_limit_exceeded',
] as const;

/** How an actor appears in a pull request. `co_author` comes from a `Co-authored-by` trailer (E08-S06). */
export const ROLES = ['opener', 'author', 'committer', 'co_author'] as const;

/** The two roles of a commit identity that GitHub could not link to an account. */
export const UNLINKED_ROLES = ['author', 'committer'] as const;

/** Findings that never block a pull request, only inform the maintainer (E08-S06). */
export const ADVISORY_CODES = ['too_many_trailers', 'co_author_unresolved'] as const;

/**
 * Allowlist entry kinds in matching order (E08-S03 prefers `user`, then `bot`, then `org_members`). Mirrors the
 * `allowlist_entries.kind` check in migrations/001_initial.sql.
 */
export const ALLOWLIST_KINDS = ['user', 'bot', 'org_members'] as const;

/** An entry applies to the whole installation or to one repository (`allowlist_entries.repository_id` null or set). */
export const ALLOWLIST_SCOPES = ['installation', 'repository'] as const;

/** `complete` is the whole commit list; `exceeded` means a limit was hit and the pull request fails closed. */
export const LISTING_STATES = ['complete', 'exceeded'] as const;

export const OUTCOMES = ['success', 'failure'] as const;
