// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { PendingReasonCode } from '../../shared/pending-prs.ts';
import { FAILURE_CODES } from '../../shared/pr-evaluation-codes.ts';
import { type PrEvaluationDetails, parseStoredDetails } from '../../shared/pr-evaluation-details.ts';

// Why a pull request is pending (E15-S07), pure: the reasons a maintainer reads, derived from the details the engine stored (E08-S01)
// and from nothing else. The stored details hold numeric ids and codes only, so a reason names an account by its id; the login is
// added by the caller from the `users` snapshot. Every code of `failureCodes` yields at least one reason with that code, so a filter on
// the code can be answered from `failureCodes` alone (services/pending-prs-reason.ts) and cannot disagree with this function.

/** A reason before the display snapshot is added: the code, and the account or the commit it is about where one applies. */
export interface PendingReason {
  readonly code: PendingReasonCode;
  readonly githubId?: number;
  readonly commitSha?: string;
}

/** What a failed evaluation that names no recognised reason is listed with, rather than being hidden. */
const OTHER: readonly PendingReason[] = [{ code: 'other' }];

/** One reason for each account, or the bare code when there is none: a code the engine stored always shows up. */
function accountReasons(
  code: 'unsigned_contributor' | 'bot_not_allowlisted',
  accounts: readonly { readonly githubId: number }[],
): PendingReason[] {
  return accounts.length === 0 ? [{ code }] : accounts.map(({ githubId }) => ({ code, githubId }));
}

/** The reasons one failure code stands for in `details`. */
function reasonsFor(code: (typeof FAILURE_CODES)[number], details: PrEvaluationDetails): PendingReason[] {
  const uncovered = details.actors.filter((actor) => !actor.covered);
  switch (code) {
    case 'unsigned_contributor':
      return accountReasons(
        code,
        uncovered.filter((actor) => actor.bot !== true),
      );
    case 'bot_not_allowlisted':
      return accountReasons(
        code,
        uncovered.filter((actor) => actor.bot === true),
      );
    case 'unlinked_identity': {
      const open = details.unlinked.filter((finding) => finding.overrideId === null);
      return open.length === 0 ? [{ code }] : open.map((finding) => ({ code, commitSha: finding.sha }));
    }
    case 'no_active_cla':
    case 'commit_limit_exceeded':
      return [{ code }];
  }
}

/**
 * The reasons a pull request with `details` is blocked, in the order of the failure codes of the engine (`no_active_cla`,
 * `unsigned_contributor`, `bot_not_allowlisted`, `unlinked_identity`, `commit_limit_exceeded`). One `unsigned_contributor` for each
 * uncovered account that is not a bot (a signature that is outdated or revoked is not told apart from none: the engine does not
 * either), one `bot_not_allowlisted` for each uncovered bot, one `unlinked_identity` for each unlinked identity no override waives,
 * with the SHA of its commit. Details with no failure code give `other`.
 */
function reasonsOfDetails(details: PrEvaluationDetails): PendingReason[] {
  const present = new Set(details.failureCodes);
  const reasons = FAILURE_CODES.filter((code) => present.has(code)).flatMap((code) => reasonsFor(code, details));
  return reasons.length === 0 ? [...OTHER] : reasons;
}

/**
 * The reasons for a stored `pr_evaluations.details` value of a failed row. A value that is not the shape of the engine's (the
 * `{ "code": "evaluation_failed" }` of the dead-letter write, a code this version does not know, junk) is a single `other`: the pull
 * request is listed, not hidden, and one bad row cannot break a page.
 */
export function pendingReasons(stored: unknown): PendingReason[] {
  const parsed = parseStoredDetails(stored);
  return parsed.ok ? reasonsOfDetails(parsed.details) : [...OTHER];
}
