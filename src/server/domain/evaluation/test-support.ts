// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ActorExtraction, ExtractedActor } from './actor-types.ts';
import type {
  Account,
  AccountType,
  AllowlistEntry,
  AllowlistKind,
  AllowlistScope,
  CommitFacts,
  EvaluationInput,
  Role,
  SignatureFact,
} from './types.ts';

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

/** An allowlist entry; by default one of the repository itself. `githubId` is a user, a bot or an organisation id. */
export function allowlistEntry(
  id: number,
  kind: AllowlistKind,
  githubId: number,
  scope: AllowlistScope = 'repository',
): AllowlistEntry {
  return { id, kind, githubId, scope };
}

/** A signature of `githubId` that covers the default policy of `evaluationInput` (document 1, major 1), not revoked. */
export function signatureFact(id: number, githubId: number, overrides: Partial<SignatureFact> = {}): SignatureFact {
  return { id, githubId, documentId: 1, versionId: 1000 + id, major: 1, revoked: false, ...overrides };
}

/** An actor as extraction would hand it over: one account with its roles and no commits unless the test names some. */
export function extractedActor(
  id: number,
  type: AccountType = 'User',
  roles: readonly Role[] = ['author'],
  shas: readonly string[] = [],
): ExtractedActor {
  return { account: account(id, type), roles, shas };
}

/** Known organisation members: `membership([500, [10, 11]])` says users 10 and 11 belong to organisation 500. */
export function membership(
  ...orgs: readonly (readonly [orgId: number, userIds: readonly number[]])[]
): ReadonlyMap<number, ReadonlySet<number>> {
  return new Map(orgs.map(([orgId, userIds]): [number, ReadonlySet<number>] => [orgId, new Set(userIds)]));
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
