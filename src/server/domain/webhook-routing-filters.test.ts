// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { CONTEXT, IDS, JOBS, payloadOf, type SubscribedEvent, without, withValue } from './test-support.ts';
import { routeWebhook } from './webhook-routing.ts';
import type { IgnoreReason, RoutingContext } from './webhook-routing-types.ts';

// The rows of the routing table that depend on what the payload says (E06-S04): whose check it is, who commented and
// what they wrote. The pairs of event and action are in webhook-routing.test.ts.

interface Row {
  readonly title: string;
  readonly event: SubscribedEvent;
  readonly payload: Record<string, unknown>;
  readonly context?: RoutingContext;
  readonly expected: object;
}

const ignored = (reason: IgnoreReason) => ({ kind: 'ignored', reason });
const RECHECK = { kind: 'job', job: JOBS.recheckComment };
const HEAD_SHA = { kind: 'job', job: JOBS.evaluateHeadSha };

const checkRun = (path: string, value: unknown) => withValue(payloadOf('check_run'), path, value);
const checkSuite = (path: string, value: unknown) => withValue(payloadOf('check_suite'), path, value);
const comment = (body: string) => withValue(payloadOf('issue_comment'), 'comment.body', body);
const sender = (type: string) => withValue(payloadOf('issue_comment'), 'sender.type', type);

const CHECKS: readonly Row[] = [
  { title: 'a check run of ours', event: 'check_run', payload: payloadOf('check_run'), expected: HEAD_SHA },
  {
    title: 'a check run with another name',
    event: 'check_run',
    payload: checkRun('check_run.name', 'ci/build'),
    expected: ignored('foreign_check'),
  },
  {
    title: 'a check run named in other case',
    event: 'check_run',
    payload: checkRun('check_run.name', 'License/CLA'),
    expected: ignored('foreign_check'),
  },
  {
    title: 'a check run whose name has a trailing space',
    event: 'check_run',
    payload: checkRun('check_run.name', 'license/cla '),
    expected: ignored('foreign_check'),
  },
  {
    title: 'a check run of another App',
    event: 'check_run',
    payload: checkRun('check_run.app.id', IDS.app + 1),
    expected: ignored('foreign_check'),
  },
  {
    title: 'a check run when no App id is configured',
    event: 'check_run',
    payload: payloadOf('check_run'),
    context: { appId: undefined, deliveryId: CONTEXT.deliveryId },
    expected: ignored('foreign_check'),
  },
  {
    title: 'a check run when the configured App id is written with a leading zero',
    event: 'check_run',
    payload: payloadOf('check_run'),
    context: { appId: `0${IDS.app}`, deliveryId: CONTEXT.deliveryId },
    expected: ignored('foreign_check'),
  },
  {
    title: 'a check run of another App that is not ours by name either',
    event: 'check_run',
    payload: withValue(checkRun('check_run.app.id', 1), 'check_run.name', 'ci/build'),
    expected: ignored('foreign_check'),
  },
  {
    title: 'a foreign check run that is also not re-requested',
    event: 'check_run',
    payload: withValue(checkRun('check_run.name', 'ci/build'), 'action', 'completed'),
    expected: ignored('foreign_check'),
  },
  { title: 'a check suite of ours', event: 'check_suite', payload: payloadOf('check_suite'), expected: HEAD_SHA },
  {
    title: 'a check suite of another App',
    event: 'check_suite',
    payload: checkSuite('check_suite.app.id', IDS.app + 1),
    expected: ignored('foreign_check'),
  },
  {
    title: 'a check suite when no App id is configured',
    event: 'check_suite',
    payload: payloadOf('check_suite'),
    context: { appId: undefined, deliveryId: CONTEXT.deliveryId },
    expected: ignored('foreign_check'),
  },
  {
    title: 'a check suite of another App that is not re-requested',
    event: 'check_suite',
    payload: withValue(checkSuite('check_suite.app.id', 1), 'action', 'completed'),
    expected: ignored('foreign_check'),
  },
];

const COMMENTS: readonly Row[] = [
  {
    title: 'a new comment with /recheck',
    event: 'issue_comment',
    payload: payloadOf('issue_comment'),
    expected: RECHECK,
  },
  { title: 'the bare command', event: 'issue_comment', payload: comment('/recheck'), expected: RECHECK },
  {
    title: 'the command at the end of a line',
    event: 'issue_comment',
    payload: comment('please /recheck'),
    expected: RECHECK,
  },
  {
    title: 'the command among other lines with CRLF',
    event: 'issue_comment',
    payload: comment('thanks\r\n/recheck\r\nbye'),
    expected: RECHECK,
  },
  {
    title: 'the command as the last line with no newline',
    event: 'issue_comment',
    payload: comment('first line\n/recheck'),
    expected: RECHECK,
  },
  {
    title: 'the command inside a quote (the job applies the exact-line rule)',
    event: 'issue_comment',
    payload: comment('> /recheck'),
    expected: RECHECK,
  },
  {
    title: 'the command inside a code fence (the job applies the exact-line rule)',
    event: 'issue_comment',
    payload: comment('```\n/recheck\n```'),
    expected: RECHECK,
  },
  {
    title: '/recheck as the start of another word',
    event: 'issue_comment',
    payload: comment('/rechecks'),
    expected: RECHECK,
  },
  {
    title: '/recheck as the end of another word',
    event: 'issue_comment',
    payload: comment('re/recheck'),
    expected: RECHECK,
  },
  {
    title: '/recheck followed by more text',
    event: 'issue_comment',
    payload: comment('/recheck now'),
    expected: RECHECK,
  },
  {
    title: 'the command in a comment of 65,536 characters',
    event: 'issue_comment',
    payload: comment(`${'x'.repeat(65_536 - '/recheck'.length)}/recheck`),
    expected: RECHECK,
  },
  {
    title: 'a comment without the command',
    event: 'issue_comment',
    payload: comment('looks good'),
    expected: ignored('no_recheck_command'),
  },
  { title: 'an empty comment', event: 'issue_comment', payload: comment(''), expected: ignored('no_recheck_command') },
  {
    title: 'the command in other case',
    event: 'issue_comment',
    payload: comment('/Recheck'),
    expected: ignored('no_recheck_command'),
  },
  {
    title: 'the command in capitals',
    event: 'issue_comment',
    payload: comment('/RECHECK'),
    expected: ignored('no_recheck_command'),
  },
  {
    title: 'a command with a space after the slash',
    event: 'issue_comment',
    payload: comment('/ recheck'),
    expected: ignored('no_recheck_command'),
  },
  {
    title: 'a command with a fullwidth solidus',
    event: 'issue_comment',
    payload: comment('／recheck'),
    expected: ignored('no_recheck_command'),
  },
  {
    title: 'a command with a zero-width space inside',
    event: 'issue_comment',
    payload: comment('/rech​eck'),
    expected: ignored('no_recheck_command'),
  },
  {
    title: 'a command with a right-to-left override before it',
    event: 'issue_comment',
    payload: comment(`${String.fromCodePoint(0x202e)}/recheck`),
    expected: RECHECK,
  },
  { title: 'a comment from a Bot', event: 'issue_comment', payload: sender('Bot'), expected: ignored('bot_sender') },
  { title: 'a comment from a User', event: 'issue_comment', payload: sender('User'), expected: RECHECK },
  {
    title: 'a comment from an Organization',
    event: 'issue_comment',
    payload: sender('Organization'),
    expected: RECHECK,
  },
  { title: 'a comment from a Mannequin', event: 'issue_comment', payload: sender('Mannequin'), expected: RECHECK },
  {
    title: 'a comment from a sender typed in lower case',
    event: 'issue_comment',
    payload: sender('bot'),
    expected: RECHECK,
  },
  {
    title: 'a comment from a sender with an empty type',
    event: 'issue_comment',
    payload: sender(''),
    expected: RECHECK,
  },
  {
    title: 'a comment on an issue that is not a pull request',
    event: 'issue_comment',
    payload: without(payloadOf('issue_comment'), 'issue.pull_request'),
    expected: ignored('not_pull_request'),
  },
  {
    title: 'a comment from a Bot on an issue that is not a pull request',
    event: 'issue_comment',
    payload: without(sender('Bot'), 'issue.pull_request'),
    expected: ignored('not_pull_request'),
  },
  {
    title: 'a comment from a Bot without the command',
    event: 'issue_comment',
    payload: withValue(sender('Bot'), 'comment.body', 'looks good'),
    expected: ignored('bot_sender'),
  },
];

test.each([...CHECKS, ...COMMENTS])('$title', ({ event, payload, context, expected }) => {
  const action = payload['action'];
  expect(routeWebhook(event, typeof action === 'string' ? action : undefined, payload, context ?? CONTEXT)).toEqual(
    expected,
  );
});

// The order of the checks is part of the table: the action first, then whether it is a pull request, the sender, the text.
const ORDER: readonly {
  readonly action: string;
  readonly senderType: string;
  readonly isPullRequest: boolean;
  readonly body: string;
  readonly reason: IgnoreReason;
}[] = [
  { action: 'edited', senderType: 'Bot', isPullRequest: false, body: 'looks good', reason: 'unsupported_action' },
  { action: 'edited', senderType: 'User', isPullRequest: true, body: '/recheck', reason: 'unsupported_action' },
  { action: 'created', senderType: 'Bot', isPullRequest: false, body: '/recheck', reason: 'not_pull_request' },
  { action: 'created', senderType: 'Bot', isPullRequest: true, body: 'looks good', reason: 'bot_sender' },
];

test.each(ORDER)(
  'a comment that is $action, from a $senderType, with pull request $isPullRequest and $body, is ignored as $reason',
  ({ action, senderType, isPullRequest, body, reason }) => {
    const base = withValue(withValue(payloadOf('issue_comment'), 'sender.type', senderType), 'comment.body', body);
    const payload = isPullRequest ? base : without(base, 'issue.pull_request');
    expect(routeWebhook('issue_comment', action, payload, CONTEXT)).toEqual(ignored(reason));
  },
);

// A check re-run resolves to the head SHA and to nothing else: `check_run.pull_requests` is empty for a fork pull
// request, and when it is not empty the router still does not copy the numbers.
test.each([
  ['check_run', 'check_run.pull_requests'],
  ['check_suite', 'check_suite.pull_requests'],
] as const)('a %s re-run is the head SHA of the check, with or without pull requests in the payload', (event, path) => {
  for (const pullRequests of [[], [{ number: 99, id: 1 }], [{ number: 99 }, { number: 100 }]]) {
    const routing = routeWebhook(event, 'rerequested', withValue(payloadOf(event), path, pullRequests), CONTEXT);
    expect(routing).toEqual(HEAD_SHA);
    expect(JSON.stringify(routing)).not.toContain('99');
  }
});

// A draft is evaluated like any other pull request, a close is a close whether the pull request was merged or not.
test.each([
  { title: 'a draft pull request opened', action: 'opened', change: ['pull_request.draft', true], type: 'evaluate-pr' },
  { title: 'a draft pull request edited', action: 'edited', change: ['pull_request.draft', true], type: 'evaluate-pr' },
  {
    title: 'a draft taken out of draft',
    action: 'ready_for_review',
    change: ['pull_request.draft', false],
    type: 'evaluate-pr',
  },
  { title: 'a merged pull request closed', action: 'closed', change: ['pull_request.merged', true], type: 'close-pr' },
  {
    title: 'an unmerged pull request closed',
    action: 'closed',
    change: ['pull_request.merged', false],
    type: 'close-pr',
  },
] as const)('$title becomes $type', ({ action, change, type }) => {
  const payload = withValue(payloadOf('pull_request'), change[0], change[1]);
  const routing = routeWebhook('pull_request', action, payload, CONTEXT);
  expect(routing.kind === 'job' ? routing.job.type : undefined).toBe(type);
});
