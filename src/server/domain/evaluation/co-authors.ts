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
 * At most this many accounts that are named only in trailers become actors. A trailer is text anyone can write, so
 * without a bound one pull request could name tens of thousands of accounts and make every later rule, and the stored
 * value, as large as the author likes. The accounts kept are the ones with the lowest numeric ids (an order that does not
 * depend on the order of the commits); a trailer of a dropped account adds `too_many_trailers` to its commit. Capping only
 * removes requirements that the same text could have added, and the opener, every author and every committer stay
 * required whatever the trailers say. An account that is already an actor (the opener, an author, a committer) does not
 * count: naming it adds a role, not an account.
 */
export const MAX_TRAILER_ONLY_ACTORS = 200;

interface TrailerReading {
  readonly sightings: Map<number, Sighting>;
  readonly advisories: readonly Advisory[];
}

/** Reads the trailers of every commit that is not a merge, once per SHA (lower case). */
function readTrailers(commits: readonly CommitFacts[]): TrailerReading {
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
    advisories.push(...parsed.advisories.map((code): Advisory => ({ code, sha })));
  }
  return { sightings, advisories };
}

/**
 * The sightings that may become actors, and the commits whose trailers were dropped. Accounts in `known` are always
 * kept; of the others the `MAX_TRAILER_ONLY_ACTORS` lowest ids are.
 */
function withinLimit(
  sightings: ReadonlyMap<number, Sighting>,
  known: ReadonlySet<number>,
): { readonly kept: ReadonlyMap<number, Sighting>; readonly droppedShas: ReadonlySet<string> } {
  const newIds = [...sightings.keys()].filter((id) => !known.has(id)).sort((a, b) => a - b);
  const dropped = new Set(newIds.slice(MAX_TRAILER_ONLY_ACTORS));
  const kept = new Map<number, Sighting>();
  const droppedShas = new Set<string>();
  for (const [id, sighting] of sightings) {
    if (dropped.has(id)) {
      for (const sha of sighting.shas) {
        droppedShas.add(sha);
      }
    } else {
      kept.set(id, sighting);
    }
  }
  return { kept, droppedShas };
}

/** One advisory per SHA and code, sorted by SHA, then code: the same finding twice on one commit says nothing more. */
function distinctAdvisories(advisories: readonly Advisory[]): Advisory[] {
  const bySha = new Map(
    advisories.map((advisory): [string, Advisory] => [`${advisory.sha} ${advisory.code}`, advisory]),
  );
  return [...bySha.values()].sort(compareAdvisories);
}

/**
 * Adds the co-authors found in the commit messages to an extraction (E08-S02) and returns it with the advisories. The
 * actors of the trailers are merged by numeric id with the ones already there, so the author who also names themselves
 * (or the opener, or a bot GitHub told us about) stays one actor with one more role and keeps the stricter account type.
 * Trailers of a skipped merge commit are not read. A SHA listed twice is the same commit and is read once. Advisories are
 * unique per SHA and code, sorted by SHA, then code, and hold no name or email. Accounts named only in trailers are capped
 * at `MAX_TRAILER_ONLY_ACTORS`.
 */
export function addCoAuthors(extraction: ActorExtraction, commits: readonly CommitFacts[]): CoAuthoredExtraction {
  const reading = readTrailers(commits);
  const known = new Set(extraction.actors.map((actor) => actor.account.id));
  const { kept, droppedShas } = withinLimit(reading.sightings, known);
  const dropped = [...droppedShas].map((sha): Advisory => ({ code: 'too_many_trailers', sha }));
  return {
    ...extraction,
    actors: mergeActors(extraction.actors, sightingsToActors(kept)),
    advisories: distinctAdvisories([...reading.advisories, ...dropped]),
  };
}
