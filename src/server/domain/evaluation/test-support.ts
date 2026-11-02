// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Account, AccountType, CommitFacts, EvaluationInput } from './types.ts';

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
