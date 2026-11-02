// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ActorExtraction } from './actor-types.ts';
import type { Account, AccountType, CommitFacts, EvaluationInput, Role } from './types.ts';

// Builders for the tests of src/server/domain/evaluation. They are plain data with sensible defaults, so a test names
// only what it is about. Nothing here is random and nothing reads a clock: a fixture is the same on every run.

/** A lower-case 40-character commit SHA made from a number: `sha(1)` is 39 zeros and a 1. */
export function sha(n: number): string {
  return n.toString(16).padStart(40, '0');
}

export function account(id: number, type: AccountType = 'User'): Account {
  return { id, type };
}

/** A single-parent commit by `author`, committed by the same account, with an empty message. */
export function commitFacts(n: number, overrides: Partial<CommitFacts> = {}): CommitFacts {
  const author = account(n);
  return {
    sha: sha(n),
    parents: [sha(n - 1)],
    author,
    committer: author,
    message: `change ${n}`,
    rawAuthor: { name: `Author ${n}`, email: `author${n}@example.org` },
    rawCommitter: { name: `Author ${n}`, email: `author${n}@example.org` },
    ...overrides,
  };
}

/** An open pull request by user 1 with no commits, a CLA at document 1 major 1, and no signatures or allowlist. */
export function evaluationInput(overrides: Partial<EvaluationInput> = {}): EvaluationInput {
  return {
    headSha: sha(1),
    opener: account(1),
    commits: [],
    listing: 'complete',
    policy: { documentId: 1, activeMajor: 1 },
    signatures: [],
    allowlist: [],
    orgMembers: new Map(),
    overrides: new Map(),
    ...overrides,
  };
}

/** What most extraction tests compare: the id, roles and commits of every actor, in output order. */
export function actorRows(
  extraction: ActorExtraction,
): readonly { readonly id: number; readonly roles: readonly Role[]; readonly shas: readonly string[] }[] {
  return extraction.actors.map((actor) => ({ id: actor.account.id, roles: actor.roles, shas: actor.shas }));
}

/**
 * A copy of `items` in an order fixed by `seed`: every item gets a key from a small seeded generator and the copy is
 * sorted by key, so a test can shuffle its input and still be the same on every run.
 */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return items
    .map((item) => ({ item, key: next() }))
    .sort((a, b) => a.key - b.key)
    .map((keyed) => keyed.item);
}
