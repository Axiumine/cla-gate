// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { CheckOutput, MergeGroupResult } from './check-view.ts';
import { renderId, renderName, shortSha } from './encode.ts';
import { renderParts } from './output-parts.ts';

// E22-S01: what the Check Run of a merge queue's group says. Every sentence is fixed text, and the only things a view adds are
// numbers: the count of the pull requests that passed and the numbers of the ones that did not, each written as `PR 123` in one
// code span (through `renderName`, the encoding of E09-S01) and never as `#123`, which GitHub would turn into a link and a
// mention of that pull request. No login, name or email is ever read here, so the output is the same whoever the contributors are
// and it is short enough to be its own minimal output (a 422 cannot be answered with less).

/** The summary of a group whose pull requests could not be determined: the one fixed sentence the story names. */
export const UNDETERMINED_SUMMARY = 'Could not determine the pull requests in this merge group';

/** What a contributor does about a group that cannot be checked: the queue cannot be told to try again (`/recheck` cannot be typed on a group). */
export const REMOVE_AND_ADD_HINT = 'Remove the pull request from the merge queue and add it again';

/** The summary of a group whose evaluation died. */
const ERRORED_SUMMARY = `Something went wrong while checking this merge group. ${REMOVE_AND_ADD_HINT}.`;

/** The titles, for a Check Run that is completed. */
const TITLES = {
  passed: 'CLA check passed',
  failed: 'CLA check failed',
  undetermined: 'CLA check failed',
  errored: 'CLA check could not complete',
} as const;

/** The sentence of a group that passed: the one pull request, or all of them. @throws InvalidIdError for a count that is not a safe integer. */
function coveredSentence(count: number): string {
  return count === 1
    ? 'The pull request in this merge group is covered by the CLA.'
    : `All ${renderId(count)} pull requests in this merge group are covered by the CLA.`;
}

/** The pull request `number` as `PR 123` in one code span. @throws InvalidIdError for a number that is not a safe integer. */
function pullRequestEntry(number: number): string {
  const label = `PR ${renderId(number)}`;
  return `- ${renderName(label)}`;
}

/** The summary of a group with pull requests that are not covered: the sentence, the list (cut by `renderParts` past 50) and what to do. */
function failedSummary(failing: readonly number[]): string {
  return renderParts([
    { kind: 'text', text: 'These pull requests in this merge group are not covered by the CLA:' },
    { kind: 'list', entries: failing.map(pullRequestEntry) },
    {
      kind: 'text',
      text: 'Each pull request shows what is missing in its own check. Remove it from the merge queue, fix that and add it again.',
    },
  ]);
}

/**
 * The completed Check Run of a merge group: `success` only for a group whose every pull request is covered, `failure` for
 * every other state.
 * @throws InvalidShaError for a head SHA that is not a full lower-case SHA, InvalidIdError for a number that is not a safe integer.
 */
export function mergeGroupOutput(headSha: string, result: MergeGroupResult): CheckOutput {
  switch (result.state) {
    case 'passed':
      return {
        status: 'completed',
        conclusion: 'success',
        title: TITLES.passed,
        summary: `${coveredSentence(result.pullRequests)}\n\nChecked commit ${shortSha(headSha)}.`,
      };
    case 'failed':
      return {
        status: 'completed',
        conclusion: 'failure',
        title: TITLES.failed,
        summary: failedSummary(result.failing),
      };
    case 'undetermined':
      return { status: 'completed', conclusion: 'failure', title: TITLES.undetermined, summary: UNDETERMINED_SUMMARY };
    case 'errored':
      return { status: 'completed', conclusion: 'failure', title: TITLES.errored, summary: ERRORED_SUMMARY };
  }
}
