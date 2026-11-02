// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ActorExtraction, UnlinkedFinding, UnlinkedRole } from './actor-types.ts';
import { GITHUB_WEB_FLOW_ID } from './github-identities.ts';
import { compareText } from './order.ts';
import { recordSighting, type Sighting, sightingsToActors } from './sightings.ts';
import type { Account, CommitFacts, EvaluationInput, RawIdentity } from './types.ts';

// E08-S02: who must be covered. The engine reads the opener and the identities of every non-merge commit, and nothing
// else: no text, no login, no email. Identity is the numeric id, so one person who appears in several places is one
// actor with several roles.

/** The committer is the author again, or GitHub's web UI committing on the author's behalf: nobody new to cover. */
function isExemptCommitter(committer: Account, author: Account | null): boolean {
  return committer.id === GITHUB_WEB_FLOW_ID || committer.id === author?.id;
}

function recordFinding(
  findings: Map<string, UnlinkedFinding>,
  sha: string,
  role: UnlinkedRole,
  raw: RawIdentity,
): void {
  findings.set(`${sha}:${role}`, { sha, role, raw });
}

function readCommit(
  commit: CommitFacts,
  sha: string,
  sightings: Map<number, Sighting>,
  findings: Map<string, UnlinkedFinding>,
): void {
  const { author, committer } = commit;
  if (author === null) {
    recordFinding(findings, sha, 'author', commit.rawAuthor);
  } else {
    recordSighting(sightings, author, 'author', sha);
  }
  if (committer === null) {
    recordFinding(findings, sha, 'committer', commit.rawCommitter);
  } else if (!isExemptCommitter(committer, author)) {
    recordSighting(sightings, committer, 'committer', sha);
  }
}

function compareFindings(a: UnlinkedFinding, b: UnlinkedFinding): number {
  return compareText(a.sha, b.sha) || compareText(a.role, b.role);
}

/**
 * Collects the actors of a pull request. The opener is always one, whatever the commits say, so a contributor cannot
 * ride on someone else's commit identities. A commit with more than one parent is skipped entirely; a root commit and a
 * single-parent commit are read. SHAs are lower-cased, so a commit listed twice is read twice but counts once as an
 * actor sighting, a finding or a merge.
 */
export function extractActors(input: EvaluationInput): ActorExtraction {
  const sightings = new Map<number, Sighting>();
  const findings = new Map<string, UnlinkedFinding>();
  const merges = new Set<string>();
  recordSighting(sightings, input.opener, 'opener');
  for (const commit of input.commits) {
    const sha = commit.sha.toLowerCase();
    if (commit.parents.length > 1) {
      merges.add(sha);
    } else {
      readCommit(commit, sha, sightings, findings);
    }
  }
  return {
    actors: sightingsToActors(sightings),
    unlinked: [...findings.values()].sort(compareFindings),
    mergeCommitsSkipped: merges.size,
  };
}
