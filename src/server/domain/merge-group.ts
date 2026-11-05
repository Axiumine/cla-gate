// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import type { MergeGroupResult } from './reporting/check-view.ts';

// The rules of a merge queue's group that need no I/O (E22-S01): which pull request the name of the group's branch gives, how many
// pull requests and commits a group may hold, what the verdicts of the member pull requests add up to and the details a group's
// evaluation row keeps. A merge group is never read back from GitHub (there is no endpoint for it): what the webhook said is all
// there is, so the rules that turn it into pull requests are unverified against a real queue until one has been observed
// (`docs/tooling-gotchas.md`, open verifications), and every doubt ends in a failure, never in a pass.

/** The most pull requests a group may hold: a group of more is not evaluated, it fails (E22-S01). */
export const MAX_MERGE_GROUP_PULL_REQUESTS = 25;

/**
 * The most commits a group's range may hold for its pull requests to be looked up one commit at a time. A group above it fails
 * closed instead of costing a request per commit.
 */
export const MAX_MERGE_GROUP_COMMITS = 250;

/**
 * The name GitHub gives the branch of a group: `refs/heads/gh-readonly-queue/<base branch>/pr-<number>-<sha>`, where the number is
 * the one of the last pull request added to the group. The base branch is any ref name, so only its place is matched; the
 * number is at most ten digits (a pull request number is a positive safe integer).
 */
const GROUP_REF = /^refs\/heads\/gh-readonly-queue\/.+\/pr-([1-9]\d{0,9})-[0-9a-f]{40}$/;

/**
 * The number of the last pull request of a group, read from the name of its branch, or `undefined` when the name does not have
 * the shape of a merge queue's branch (the job then cannot name a pull request and fails closed).
 */
export function tipPullRequestOf(headRef: string): number | undefined {
  const digits = GROUP_REF.exec(headRef)?.[1];
  return digits === undefined ? undefined : Number(digits);
}

/** What the engine concluded about one member pull request: the outcome and the codes of its failure, numbers and words of a closed set only. */
export interface MemberResult {
  readonly prNumber: number;
  readonly outcome: 'success' | 'failure';
  readonly failureCodes: readonly string[];
}

/**
 * What the verdicts of the member pull requests add up to: a pass only when every one of them passes (and there is at least one),
 * and otherwise a failure that names the pull requests that did not pass, in the order they were given.
 */
export function resultOfMembers(members: readonly MemberResult[]): MergeGroupResult {
  const failing = members.filter((member) => member.outcome === 'failure').map((member) => member.prNumber);
  if (members.length === 0) {
    return { state: 'undetermined' };
  }
  return failing.length === 0 ? { state: 'passed', pullRequests: members.length } : { state: 'failed', failing };
}

/** The most failure codes the details of a pull request keep: far above what the engine emits, so a row stays small whatever it is given. */
const MAX_CODES = 20;

/** Why a group failed without a verdict on its pull requests: they could not be determined, or the evaluation died (the dead letter). */
const DETAIL_CODES = ['pull_requests_not_determined', 'evaluation_failed'] as const;

/**
 * What `merge_group_evaluations.details` holds (version 1, strict): the outcome, the code of a failure that has no verdict on the
 * pull requests, and the pull requests that were evaluated with their outcome and failure codes. Numeric ids and words of a closed
 * set only: no login, name, email or text of a delivery. At most {@link MAX_MERGE_GROUP_PULL_REQUESTS} entries.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const mergeGroupDetailsSchema = z.strictObject({
  version: z.literal(1),
  outcome: z.enum(['success', 'failure']),
  code: z.enum(DETAIL_CODES).optional(),
  pullRequests: z
    .array(
      z.strictObject({
        number: z.int().positive(),
        outcome: z.enum(['success', 'failure']),
        failureCodes: z.array(z.string().max(64)).max(MAX_CODES),
      }),
    )
    .max(MAX_MERGE_GROUP_PULL_REQUESTS),
});

/** The details a group's row keeps. */
export type MergeGroupDetails = z.infer<typeof mergeGroupDetailsSchema>;

/** The details of an evaluation that reached a verdict on every member pull request. */
export function detailsOfMembers(members: readonly MemberResult[]): MergeGroupDetails {
  return mergeGroupDetailsSchema.parse({
    version: 1,
    outcome: resultOfMembers(members).state === 'passed' ? 'success' : 'failure',
    pullRequests: members.map((member) => ({
      number: member.prNumber,
      outcome: member.outcome,
      failureCodes: member.failureCodes.slice(0, MAX_CODES),
    })),
  });
}

/** The details of a group that failed with no verdict on its pull requests, for the `code`. */
export function detailsOfFailure(code: (typeof DETAIL_CODES)[number]): MergeGroupDetails {
  return { version: 1, outcome: 'failure', code, pullRequests: [] };
}
