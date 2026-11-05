// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { jobSchema } from './jobs.ts';
import {
  CONTEXT,
  DELIVERY_ID,
  GROUP_BASE_SHA,
  GROUP_SHA,
  GROUP_TIP_NUMBER,
  IDS,
  JOBS,
  payloadOf,
  type SubscribedEvent,
  sorted,
  withValue,
} from './test-support.ts';
import { ROUTED_EVENTS, routeWebhook, SUBSCRIBED_EVENTS } from './webhook-routing.ts';
import type { Routing } from './webhook-routing-types.ts';

// The routing table of E06-S04, row by row: the contract that the story gives as a table and E07 implements.

/** What a row expects. A job is compared whole, ids and delivery id included. */
interface Expected {
  readonly kind: string;
}
const jobOf = (job: object) => ({ kind: 'job', job });
const EVALUATE_PR = jobOf(JOBS.evaluatePr);
const CLOSE_PR = jobOf(JOBS.closePr);
const EVALUATE_HEAD_SHA = jobOf(JOBS.evaluateHeadSha);
const RECHECK_COMMENT = jobOf(JOBS.recheckComment);
const EVALUATE_MERGE_GROUP = jobOf(JOBS.evaluateMergeGroup);
const DESTROYED_GROUP = {
  kind: 'destroyed',
  group: {
    githubInstallationId: IDS.installation,
    githubRepoId: IDS.repository,
    headSha: GROUP_SHA,
    baseSha: GROUP_BASE_SHA,
    deliveryId: DELIVERY_ID,
  },
};
const SYNC_INSTALLATION = jobOf(JOBS.syncInstallation);
const REVOKE_USER_SESSIONS = jobOf(JOBS.revokeUserSessions);
const UNSUPPORTED_ACTION = { kind: 'ignored', reason: 'unsupported_action' };
const UNSUPPORTED_EVENT = { kind: 'ignored', reason: 'unsupported_event' };
const PONG = { kind: 'pong' };

// Every (event, action) pair of the table, the ignored ones included, sent with the default payload of its event.
const PAIRS: readonly (readonly [event: SubscribedEvent, action: string | undefined, expected: Expected])[] = [
  ['pull_request', 'opened', EVALUATE_PR],
  ['pull_request', 'reopened', EVALUATE_PR],
  ['pull_request', 'synchronize', EVALUATE_PR],
  ['pull_request', 'edited', EVALUATE_PR],
  ['pull_request', 'ready_for_review', EVALUATE_PR],
  ['pull_request', 'closed', CLOSE_PR],
  ['pull_request', 'labeled', UNSUPPORTED_ACTION],
  ['pull_request', 'unlabeled', UNSUPPORTED_ACTION],
  ['pull_request', 'assigned', UNSUPPORTED_ACTION],
  ['pull_request', 'review_requested', UNSUPPORTED_ACTION],
  ['pull_request', 'converted_to_draft', UNSUPPORTED_ACTION],
  ['pull_request', 'locked', UNSUPPORTED_ACTION],
  ['pull_request', 'auto_merge_enabled', UNSUPPORTED_ACTION],
  ['pull_request', 'enqueued', UNSUPPORTED_ACTION],
  ['pull_request', 'OPENED', UNSUPPORTED_ACTION],
  ['pull_request', 'opened ', UNSUPPORTED_ACTION],
  ['pull_request', '', UNSUPPORTED_ACTION],
  ['pull_request', undefined, UNSUPPORTED_ACTION],
  ['pull_request', '__proto__', UNSUPPORTED_ACTION],
  ['check_run', 'rerequested', EVALUATE_HEAD_SHA],
  ['check_run', 'created', UNSUPPORTED_ACTION],
  ['check_run', 'completed', UNSUPPORTED_ACTION],
  ['check_run', 'requested_action', UNSUPPORTED_ACTION],
  ['check_run', 'Rerequested', UNSUPPORTED_ACTION],
  ['check_run', undefined, UNSUPPORTED_ACTION],
  ['check_suite', 'rerequested', EVALUATE_HEAD_SHA],
  ['check_suite', 'requested', UNSUPPORTED_ACTION],
  ['check_suite', 'completed', UNSUPPORTED_ACTION],
  ['check_suite', undefined, UNSUPPORTED_ACTION],
  ['issue_comment', 'created', RECHECK_COMMENT],
  ['issue_comment', 'edited', UNSUPPORTED_ACTION],
  ['issue_comment', 'deleted', UNSUPPORTED_ACTION],
  ['issue_comment', 'Created', UNSUPPORTED_ACTION],
  ['issue_comment', undefined, UNSUPPORTED_ACTION],
  ['merge_group', 'checks_requested', EVALUATE_MERGE_GROUP],
  ['merge_group', 'destroyed', DESTROYED_GROUP],
  ['merge_group', 'Checks_Requested', UNSUPPORTED_ACTION],
  ['merge_group', 'Destroyed', UNSUPPORTED_ACTION],
  ['merge_group', 'an_action_github_adds_later', UNSUPPORTED_ACTION],
  ['merge_group', '', UNSUPPORTED_ACTION],
  ['merge_group', undefined, UNSUPPORTED_ACTION],
  ['installation', 'created', SYNC_INSTALLATION],
  ['installation', 'deleted', SYNC_INSTALLATION],
  ['installation', 'suspend', SYNC_INSTALLATION],
  ['installation', 'unsuspend', SYNC_INSTALLATION],
  ['installation', 'new_permissions_accepted', SYNC_INSTALLATION],
  ['installation', 'an_action_github_adds_later', SYNC_INSTALLATION],
  ['installation', '', SYNC_INSTALLATION],
  ['installation', undefined, SYNC_INSTALLATION],
  ['installation_repositories', 'added', SYNC_INSTALLATION],
  ['installation_repositories', 'removed', SYNC_INSTALLATION],
  ['installation_repositories', 'an_action_github_adds_later', SYNC_INSTALLATION],
  ['installation_repositories', undefined, SYNC_INSTALLATION],
  ['github_app_authorization', 'revoked', REVOKE_USER_SESSIONS],
  ['github_app_authorization', 'Revoked', UNSUPPORTED_ACTION],
  ['github_app_authorization', 'granted', UNSUPPORTED_ACTION],
  ['github_app_authorization', undefined, UNSUPPORTED_ACTION],
];

test.each(PAIRS)('%s with action %s', (event, action, expected) => {
  expect(routeWebhook(event, action, payloadOf(event), CONTEXT)).toEqual(expected);
});

// `ping` is answered whatever it carries, and nothing else is: no row, no job. The other events are not subscribed to.
const UNROUTED: readonly (readonly [event: string, expected: Expected])[] = [
  ['ping', PONG],
  ['push', UNSUPPORTED_EVENT],
  ['repository', UNSUPPORTED_EVENT],
  ['issues', UNSUPPORTED_EVENT],
  ['release', UNSUPPORTED_EVENT],
  ['workflow_run', UNSUPPORTED_EVENT],
  ['pull_request_review', UNSUPPORTED_EVENT],
  ['pull_request_review_comment', UNSUPPORTED_EVENT],
  ['status', UNSUPPORTED_EVENT],
  ['Pull_Request', UNSUPPORTED_EVENT],
  ['PING', UNSUPPORTED_EVENT],
  ['', UNSUPPORTED_EVENT],
  ['constructor', UNSUPPORTED_EVENT],
  ['__proto__', UNSUPPORTED_EVENT],
  ['toString', UNSUPPORTED_EVENT],
  ['hasOwnProperty', UNSUPPORTED_EVENT],
  ['valueOf', UNSUPPORTED_EVENT],
];

test.each(UNROUTED)(
  'the event %s is answered or ignored, whatever action and payload it carries',
  (event, expected) => {
    expect(routeWebhook(event, 'opened', payloadOf('pull_request'), CONTEXT)).toEqual(expected);
    expect(routeWebhook(event, undefined, undefined, CONTEXT)).toEqual(expected);
  },
);

test('the router has one row for every subscribed event and none for another', () => {
  expect(sorted(ROUTED_EVENTS)).toEqual(sorted(SUBSCRIBED_EVENTS));
  expect(new Set(SUBSCRIBED_EVENTS).size).toBe(SUBSCRIBED_EVENTS.length);
  expect(SUBSCRIBED_EVENTS).not.toContain('ping');
});

test.each(SUBSCRIBED_EVENTS)('the subscribed event %s is routed, never reported as unsupported', (event) => {
  expect(routeWebhook(event, undefined, payloadOf(event), CONTEXT)).not.toEqual(UNSUPPORTED_EVENT);
});

// The widest net: every subscribed event with every action of the table and some more. Whatever the pair, the outcome
// is one job that belongs to the catalogue, or an ignore: never two jobs, never a pong.
const ACTIONS = [
  ...new Set(PAIRS.map(([, action]) => action)),
  'merged',
  'rerequested',
  'created',
  'completed',
  'unknown',
  '🙂',
];

/** The job of a routing, or `undefined` for an ignore. A pong is a failure of the test. */
function jobOfRouting(routing: Routing) {
  expect(routing.kind).not.toBe('pong');
  return routing.kind === 'job' ? routing.job : undefined;
}

test.each(SUBSCRIBED_EVENTS)('every action of %s maps to exactly one job or to an ignore', (event) => {
  for (const action of ACTIONS) {
    const job = jobOfRouting(routeWebhook(event, action, payloadOf(event), CONTEXT));
    expect(job === undefined || jobSchema.safeParse(job).success).toBe(true);
  }
});

test('every job of the table is a job of the catalogue that carries the delivery id', () => {
  const jobs = PAIRS.flatMap(([event, action]) => {
    const job = jobOfRouting(routeWebhook(event, action, payloadOf(event), CONTEXT));
    return job === undefined ? [] : [job];
  });
  expect(jobs).toHaveLength(PAIRS.filter(([, , expected]) => expected.kind === 'job').length);
  for (const job of jobs) {
    expect(jobSchema.parse(job)).toEqual(job);
    expect(job.deliveryId).toBe(CONTEXT.deliveryId);
  }
});

/** The job of a group's `checks_requested` delivery whose branch is named `headRef`. */
function groupJob(headRef: string) {
  const payload = withValue(payloadOf('merge_group'), 'merge_group.head_ref', headRef);
  return jobOfRouting(routeWebhook('merge_group', 'checks_requested', payload, CONTEXT));
}

test('the job of a merge group carries the ids, both SHAs and the number of the last pull request, and nothing the delivery wrote', () => {
  const job = groupJob(`refs/heads/gh-readonly-queue/main/pr-${GROUP_TIP_NUMBER}-${GROUP_SHA}`);
  expect(job).toEqual(JOBS.evaluateMergeGroup);
  expect(JSON.stringify(job)).not.toContain('CANARY');
  expect(job).toMatchObject({ headSha: GROUP_SHA, baseSha: GROUP_BASE_SHA });
});

test.each([
  ['a branch that is not a merge queue branch', 'refs/heads/feature/pr-41'],
  ['a number with a leading zero', `refs/heads/gh-readonly-queue/main/pr-041-${GROUP_SHA}`],
  ['a number of eleven digits', `refs/heads/gh-readonly-queue/main/pr-12345678901-${GROUP_SHA}`],
  ['a number of zero', `refs/heads/gh-readonly-queue/main/pr-0-${GROUP_SHA}`],
  ['a SHA that is not forty digits', 'refs/heads/gh-readonly-queue/main/pr-41-abc123'],
  ['a name with text after the SHA', `refs/heads/gh-readonly-queue/main/pr-41-${GROUP_SHA}-x`],
  ['no base branch', `refs/heads/gh-readonly-queue/pr-41-${GROUP_SHA}`],
  ['an empty name', ''],
])('the job of a group whose branch is %s names no pull request, so the job fails closed', (_name, headRef) => {
  const job = groupJob(headRef);
  expect(job).toBeDefined();
  expect(job).not.toHaveProperty('tipPrNumber');
  expect(job).toMatchObject({ type: 'evaluate-merge-group', headSha: GROUP_SHA });
});

test('a base branch with slashes still gives the number of the last pull request', () => {
  const job = groupJob(`refs/heads/gh-readonly-queue/release/2026/pr-9-${GROUP_SHA}`);
  expect(job).toMatchObject({ tipPrNumber: 9 });
});
