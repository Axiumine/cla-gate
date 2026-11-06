// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { DOCUMENTS } from './ids.ts';
import { DAN, type Person } from './people.ts';

// E18-S12: the pull requests the seeded tenant has evaluated, as the rows `pr_evaluations` hold them.

/** The details a failed evaluation stores, for `actor`, who has not signed. */
function failure(actor: Person, code: 'unsigned_contributor' | 'unlinked_identity'): string {
  return JSON.stringify({
    version: 1,
    outcome: 'failure',
    failureCodes: [code],
    documentId: DOCUMENTS.individual.id,
    activeMajor: 2,
    commitCount: 2,
    mergeCommitsSkipped: 0,
    listing: 'complete',
    actors: [{ githubId: actor.githubId, roles: ['author', 'opener'], covered: false, basis: null }],
    unlinked: code === 'unlinked_identity' ? [{ sha: 'b'.repeat(40), role: 'author', overrideId: null }] : [],
    advisories: [],
  });
}

/** The pull requests that failed the check: two open (one with an unsigned author, one with an unlinked commit) and one closed. */
export const EVALUATIONS = [
  {
    id: 9701,
    pr: 23,
    sha: 'a'.repeat(40),
    state: 'open',
    details: failure(DAN, 'unsigned_contributor'),
    when: '2026-03-25T10:00:00Z',
  },
  {
    id: 9702,
    pr: 24,
    sha: 'c'.repeat(40),
    state: 'open',
    details: failure(DAN, 'unlinked_identity'),
    when: '2026-03-26T10:00:00Z',
  },
  {
    id: 9703,
    pr: 25,
    sha: 'd'.repeat(40),
    state: 'closed',
    details: failure(DAN, 'unsigned_contributor'),
    when: '2026-03-27T10:00:00Z',
  },
] as const;
