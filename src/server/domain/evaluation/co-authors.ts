// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ActorExtraction, CoAuthoredExtraction } from './actor-types.ts';
import { isMergeCommit } from './actors.ts';
import { compareAdvisories } from './order.ts';
import { mergeActors, recordSighting, type Sighting, sightingsToActors } from './sightings.ts';
import { parseCoAuthors } from './trailers.ts';
import type { Advisory, CommitFacts } from './types.ts';

// E08-S06: the co-authors of a pull request. A `Co-authored-by` trailer that names an account by its numeric id in the
// GitHub noreply form makes that account an actor with the role `co_author`, covered by the same rules as the opener,
// an author or a committer (E08-S03, E08-S04). The type is `Unknown` because the trailer says nothing about it.

/**
 * Adds the co-authors found in the commit messages to an extraction (E08-S02) and returns it with the advisories. The
 * actors of the trailers are merged by numeric id with the ones already there, so the author who also names themselves
 * (or the opener, or a bot GitHub told us about) stays one actor with one more role and keeps the stricter account type.
 * Trailers of a skipped merge commit are not read. A SHA listed twice is the same commit and is read once. Advisories are
 * sorted by SHA, then code, and hold no name or email.
 */
export function addCoAuthors(extraction: ActorExtraction, commits: readonly CommitFacts[]): CoAuthoredExtraction {
  const sightings = new Map<number, Sighting>();
  const advisories: Advisory[] = [];
  const read = new Set<string>();
  for (const commit of commits) {
    const sha = commit.sha.toLowerCase();
    if (isMergeCommit(commit) || read.has(sha)) {
      continue;
    }
    read.add(sha);
    const parsed = parseCoAuthors(commit.message);
    for (const githubId of parsed.githubIds) {
      recordSighting(sightings, { id: githubId, type: 'Unknown' }, 'co_author', sha);
    }
    for (const code of parsed.advisories) {
      advisories.push({ code, sha });
    }
  }
  return {
    ...extraction,
    actors: mergeActors(extraction.actors, sightingsToActors(sightings)),
    advisories: advisories.toSorted(compareAdvisories),
  };
}
