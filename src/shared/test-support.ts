// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { PrEvaluationDetails } from './pr-evaluation-details.ts';

/**
 * A stored evaluation that uses every field: both covering bases, an actor with several roles, an uncovered co-author,
 * an overridden and a plain unlinked finding, and an advisory. Ids and SHAs are made up. A fresh object on every call, so
 * a test can change it freely.
 */
export function storedDetailsSample(): PrEvaluationDetails {
  return {
    version: 1,
    outcome: 'failure',
    failureCodes: ['unlinked_identity', 'unsigned_contributor'],
    documentId: 12,
    activeMajor: 2,
    commitCount: 3,
    mergeCommitsSkipped: 1,
    listing: 'complete',
    actors: [
      {
        githubId: 1001,
        roles: ['opener', 'author'],
        covered: true,
        basis: { kind: 'signature', signatureId: 31, versionId: 7, major: 2 },
      },
      {
        githubId: 1002,
        roles: ['committer'],
        covered: true,
        basis: { kind: 'allowlist', entryId: 4, entryKind: 'org_members', scope: 'installation' },
      },
      { githubId: 1003, roles: ['co_author'], covered: false, basis: null },
    ],
    unlinked: [
      { sha: 'a'.repeat(40), role: 'author', overrideId: null },
      { sha: 'b'.repeat(64), role: 'committer', overrideId: 55 },
    ],
    advisories: [{ code: 'co_author_unresolved', sha: 'c'.repeat(40) }],
  };
}
