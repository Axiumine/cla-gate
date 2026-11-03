// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { renderName, shortSha } from './encode.ts';
import type { ReportedFinding, ReportedUnlinkedRole } from './failure-input.ts';

// E09-S03: the commits whose author or committer GitHub could not link to an account, for the `Email not linked to a GitHub
// account` section. A commit is one entry however many of its identities are unlinked. The address is never printed: the entry
// has the name git recorded, and the fix text tells the author how to read the address of the commit.

/** What the entry says of each role: the name was recorded as author, or as committer. */
const verbOf = (role: ReportedUnlinkedRole): string => (role === 'author' ? 'authored as' : 'committed as');

/** The roles in the order an entry names them. */
const ROLE_ORDER: readonly ReportedUnlinkedRole[] = ['author', 'committer'];

/** The commits of the `Email not linked to a GitHub account` section. */
export interface UnlinkedCommits {
  /** One Markdown bullet per commit that has an unlinked identity no override waives, in the order of the findings. */
  readonly entries: readonly string[];
  readonly count: number;
  /** How many commits have an identity that a maintainer override waives; such a commit is not listed. */
  readonly overridden: number;
}

/** ``- commit `a1b2c3d`: authored as `Jane Doe` (email not linked to a GitHub account)``. */
function entryOf(sha: string, names: ReadonlyMap<ReportedUnlinkedRole, string>): string {
  const identities = ROLE_ORDER.flatMap((role) => {
    const name = names.get(role);
    return name === undefined ? [] : [`${verbOf(role)} ${renderName(name)}`];
  });
  return `- commit \`${shortSha(sha)}\`: ${identities.join(', ')} (email not linked to a GitHub account)`;
}

/**
 * The findings grouped by commit (lower-case SHA). A finding that an override waives is counted, once per commit, and not
 * listed. @throws InvalidShaError for a SHA that is not a full commit SHA.
 */
export function unlinkedCommits(findings: readonly ReportedFinding[]): UnlinkedCommits {
  const open = new Map<string, Map<ReportedUnlinkedRole, string>>();
  const overridden = new Set<string>();
  for (const finding of findings) {
    const sha = finding.sha.toLowerCase();
    if (finding.overrideId === null) {
      const names = open.get(sha) ?? new Map<ReportedUnlinkedRole, string>();
      open.set(sha, names.set(finding.role, finding.raw.name));
    } else {
      overridden.add(sha);
    }
  }
  return {
    entries: [...open].map(([sha, names]) => entryOf(sha, names)),
    count: open.size,
    overridden: overridden.size,
  };
}
