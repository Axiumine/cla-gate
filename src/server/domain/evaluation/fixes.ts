// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { EvaluationFix } from './evaluation-types.ts';
import { compareText } from './order.ts';

// E08-S08: the one order of the fixes of a result. The rules of E08-S04, E08-S05 and the listing check each produce their
// own fixes; the composition merges them, and this order makes the merged list independent of how they were produced.

/** What a fix points at: an account (by numeric id), or one role of one commit. A fix about neither has all three empty. */
type FixTarget = readonly [githubId: number, sha: string, role: string];

function targetOf(fix: EvaluationFix): FixTarget {
  switch (fix.code) {
    case 'sign_cla':
    case 'allowlist_bot':
    case 'allowlist_account':
      return [fix.githubId, '', ''];
    case 'link_commit_email':
      return [0, fix.sha, fix.role];
    case 'maintainer_override':
      return [0, fix.sha, ''];
    case 'split_pull_request':
      return [0, '', ''];
  }
}

/** Orders fixes by code, then by the numeric id they name, then by SHA, then by role. Codes and SHAs are plain ASCII. */
export function compareEvaluationFixes(a: EvaluationFix, b: EvaluationFix): number {
  const [aId, aSha, aRole] = targetOf(a);
  const [bId, bSha, bRole] = targetOf(b);
  return compareText(a.code, b.code) || aId - bId || compareText(aSha, bSha) || compareText(aRole, bRole);
}
