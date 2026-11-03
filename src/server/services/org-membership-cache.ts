// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../shared/github-id.ts';
import type { Clock } from './ports/clock.ts';

// The memory of the membership lookup (E07-S10): what GitHub said about one person in one installation, kept for a short
// while so the pull requests of a busy organisation do not each ask again. In memory, per process, keyed by two numeric ids
// (the installation and the person) and holding a verdict, so nothing about a person but an id is kept. The key carries the
// installation: a verdict is a fact about one organisation, and what holds for one tenant says nothing about another.

/** The two verdicts that are an answer of GitHub's: `permission_missing` and a failed lookup are no answer and never kept. */
export type CachedVerdict = 'member' | 'not_member';

/**
 * How long a `member` is believed: a person removed from the organisation stays exempt this long at most.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const MEMBER_TTL_MS = 10 * 60_000;

/**
 * How long a `not_member` is believed: shorter, so a person who has just joined is not held back and asked to sign for long.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const NOT_MEMBER_TTL_MS = 2 * 60_000;

/**
 * The cache never holds more verdicts than this.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const MAX_CACHED_VERDICTS = 10_000;

const ttlOf = (verdict: CachedVerdict): number => (verdict === 'member' ? MEMBER_TTL_MS : NOT_MEMBER_TTL_MS);

export interface OrgMembershipCache {
  /** The verdict held for this person in this installation, or undefined when none is held or the one held has expired. */
  get(githubInstallationId: GithubId, userGithubId: GithubId): CachedVerdict | undefined;
  /** Holds `verdict` for this person in this installation from now on, replacing any earlier one. */
  set(githubInstallationId: GithubId, userGithubId: GithubId, verdict: CachedVerdict): void;
}

interface Held {
  readonly verdict: CachedVerdict;
  /** The first millisecond at which the verdict is no longer believed. A read does not move it. */
  readonly expiresAtMs: number;
}

const keyOf = (githubInstallationId: GithubId, userGithubId: GithubId): string =>
  `${githubInstallationId}:${userGithubId}`;

/**
 * The cache: a verdict is believed for its time from the moment it was stored (reading it never extends it, or a person
 * asked about all day would never be asked again), and when {@link MAX_CACHED_VERDICTS} is passed the verdict used least
 * recently, read or stored, is forgotten, so memory is bounded.
 */
export function createOrgMembershipCache(clock: Clock): OrgMembershipCache {
  // A `Map` keeps insertion order and a key is re-inserted every time it is used, so the first key is the least recently used.
  const held = new Map<string, Held>();
  return {
    get(githubInstallationId, userGithubId) {
      const key = keyOf(githubInstallationId, userGithubId);
      const entry = held.get(key);
      if (entry === undefined) {
        return undefined;
      }
      held.delete(key);
      if (clock.now().getTime() >= entry.expiresAtMs) {
        return undefined;
      }
      held.set(key, entry);
      return entry.verdict;
    },
    set(githubInstallationId, userGithubId, verdict) {
      const key = keyOf(githubInstallationId, userGithubId);
      held.delete(key);
      held.set(key, { verdict, expiresAtMs: clock.now().getTime() + ttlOf(verdict) });
      for (const oldest of held.keys().take(Math.max(0, held.size - MAX_CACHED_VERDICTS))) {
        held.delete(oldest);
      }
    },
  };
}
