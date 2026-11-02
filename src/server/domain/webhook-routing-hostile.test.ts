// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { ZodError } from 'zod';
import {
  CANARY,
  CONTEXT,
  IDS,
  JOBS,
  payloadOf,
  prototypeNames,
  type SubscribedEvent,
  sorted,
  withValue,
} from './test-support.ts';
import { routeWebhook, SUBSCRIBED_EVENTS } from './webhook-routing.ts';
import type { Routing } from './webhook-routing-types.ts';

// What the router does with payloads it is not meant to get, and with the ones it is (E06-S04). The schemas of E06-S03
// refuse the hostile shapes before the router runs; the router does not rely on it: it reads every id through its own
// check, so no value that is not a GitHub id can reach a job.

/** The installation a routing names, or `undefined` for an ignore and for the job that names a user only. */
function installationOf(routing: Routing): number | undefined {
  return routing.kind === 'job' && 'githubInstallationId' in routing.job ? routing.job.githubInstallationId : undefined;
}

const JOB_KEYS = new Set([
  'type',
  'trigger',
  'deliveryId',
  'githubInstallationId',
  'githubRepoId',
  'prNumber',
  'commentId',
  'headSha',
  'githubUserId',
]);

test.each(SUBSCRIBED_EVENTS)('the job of %s holds ids and the delivery id, and not a word of the payload', (event) => {
  const routing = routeWebhook(event, 'unused', payloadOf(event), CONTEXT);
  const job = routing.kind === 'job' ? routing.job : { type: 'no job' };
  const keys = Object.keys(job);
  expect(keys.every((key) => JOB_KEYS.has(key))).toBe(true);
  expect(JSON.stringify(job)).not.toContain(CANARY);
});

test.each([
  ['pull_request', 'opened', JOBS.evaluatePr],
  ['check_run', 'rerequested', JOBS.evaluateHeadSha],
  ['issue_comment', 'created', JOBS.recheckComment],
  ['installation', 'created', JOBS.syncInstallation],
  ['github_app_authorization', 'revoked', JOBS.revokeUserSessions],
] as const)('%s %s: every id of the job comes from the field that names it', (event, action, expected) => {
  expect(routeWebhook(event, action, payloadOf(event), CONTEXT)).toEqual({ kind: 'job', job: expected });
});

// Tenancy: the installation of a job is `installation.id` and no other number of the payload. A payload that names
// installation A in `installation.id` and carries the ids of other accounts elsewhere gives a job for A only.
const DECOYS: readonly (readonly [event: SubscribedEvent, path: string])[] = [
  ['pull_request', 'repository.owner.id'],
  ['pull_request', 'sender.id'],
  ['pull_request', 'pull_request.user.id'],
  ['pull_request', 'pull_request.id'],
  ['check_run', 'check_run.id'],
  ['check_run', 'check_run.app.id'],
  ['check_suite', 'check_suite.app.id'],
  ['issue_comment', 'sender.id'],
  ['issue_comment', 'comment.id'],
  ['installation', 'installation.account.id'],
  ['installation', 'sender.id'],
  ['installation_repositories', 'installation.account.id'],
];

test.each(DECOYS)('%s: the installation of the job is not the number at %s', (event, path) => {
  const other = IDS.installation + 1;
  const routing = routeWebhook(event, undefined, withValue(payloadOf(event), path, other), CONTEXT);
  expect(installationOf(routing)).not.toBe(other);
});

const TENANT_ROWS: readonly (readonly [event: SubscribedEvent, action: string])[] = [
  ['pull_request', 'opened'],
  ['pull_request', 'closed'],
  ['check_run', 'rerequested'],
  ['check_suite', 'rerequested'],
  ['issue_comment', 'created'],
  ['installation', 'created'],
  ['installation_repositories', 'removed'],
];

test.each(TENANT_ROWS)(
  '%s %s: a delivery for another installation gives a job for that installation',
  (event, action) => {
    const other = IDS.installation + 1000;
    const routing = routeWebhook(event, action, withValue(payloadOf(event), 'installation.id', other), CONTEXT);
    expect(installationOf(routing)).toBe(other);
  },
);

test.each(TENANT_ROWS.filter(([event]) => !event.startsWith('installation')))(
  '%s %s: the repository of the job is repository.id',
  (event, action) => {
    const other = IDS.repository + 1000;
    const routing = routeWebhook(event, action, withValue(payloadOf(event), 'repository.id', other), CONTEXT);
    expect(routing.kind === 'job' && 'githubRepoId' in routing.job ? routing.job.githubRepoId : undefined).toBe(other);
  },
);

// Shapes the event schemas refuse. Each one makes the router fail loudly instead of building a job with a bad id.
const BAD_ID_VALUES: readonly unknown[] = [
  '31001',
  '00031001',
  '99999999999999999999',
  1.5,
  -1,
  0,
  2 ** 53,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  null,
  true,
  [31_001],
  { id: 31_001 },
  31_001n,
  undefined,
];

const ID_PATHS: readonly (readonly [event: SubscribedEvent, path: string])[] = [
  ['pull_request', 'installation.id'],
  ['pull_request', 'repository.id'],
  ['pull_request', 'pull_request.number'],
  ['check_run', 'installation.id'],
  ['check_run', 'check_run.app.id'],
  ['check_suite', 'repository.id'],
  ['issue_comment', 'comment.id'],
  ['issue_comment', 'issue.number'],
  ['installation', 'installation.id'],
  ['installation_repositories', 'installation.id'],
  ['github_app_authorization', 'sender.id'],
];

test.each(ID_PATHS)('%s: a %s that is not a GitHub id never reaches a job', (event, path) => {
  for (const value of BAD_ID_VALUES) {
    expect(() => routeWebhook(event, 'opened', withValue(payloadOf(event), path, value), CONTEXT)).toThrow(ZodError);
  }
});

const SHAPES: readonly (readonly [title: string, event: SubscribedEvent, payload: unknown])[] = [
  ['a pull request payload that is null', 'pull_request', null],
  ['a pull request payload that is undefined', 'pull_request', undefined],
  ['a check run payload that is a string', 'check_run', 'payload'],
  ['a check suite payload that is an array', 'check_suite', [payloadOf('check_suite')]],
  ['a comment payload that is a number', 'issue_comment', 7],
  ['an installation payload that is an empty object', 'installation', {}],
  ['an authorization payload that is a function', 'github_app_authorization', () => undefined],
  ['no installation', 'pull_request', withValue(payloadOf('pull_request'), 'installation', undefined)],
  [
    'an installation that is an array',
    'pull_request',
    withValue(payloadOf('pull_request'), 'installation', [{ id: 1 }]),
  ],
  ['an installation that is null', 'check_run', withValue(payloadOf('check_run'), 'installation', null)],
  ['a repository that is a string', 'check_suite', withValue(payloadOf('check_suite'), 'repository', '52002')],
  ['a pull request of the wrong type', 'pull_request', withValue(payloadOf('pull_request'), 'pull_request', 'x')],
  [
    'a head sha in capitals',
    'check_run',
    withValue(payloadOf('check_run'), 'check_run.head_sha', 'ABCDEF'.repeat(7).slice(0, 40)),
  ],
  [
    'a head sha of 41 digits',
    'check_suite',
    withValue(payloadOf('check_suite'), 'check_suite.head_sha', 'a'.repeat(41)),
  ],
  [
    'a head sha with a newline',
    'check_run',
    withValue(payloadOf('check_run'), 'check_run.head_sha', `${'a'.repeat(40)}\n`),
  ],
  ['a comment body that is not a string', 'issue_comment', withValue(payloadOf('issue_comment'), 'comment.body', 7)],
  ['a sender type that is null', 'issue_comment', withValue(payloadOf('issue_comment'), 'sender.type', null)],
  ['an issue that is not an object', 'issue_comment', withValue(payloadOf('issue_comment'), 'issue', 'x')],
  [
    'a pull request marker that is null',
    'issue_comment',
    withValue(payloadOf('issue_comment'), 'issue.pull_request', null),
  ],
  ['a check name that is a number', 'check_run', withValue(payloadOf('check_run'), 'check_run.name', 7)],
];

test.each(SHAPES)('%s is refused with a ZodError and builds no job', (_title, event, payload) => {
  expect(() => routeWebhook(event, 'opened', payload, CONTEXT)).toThrow(ZodError);
});

test('the refusal names fields, and nothing the payload held', () => {
  const secret = 'canary-value-8e1f5b2a';
  const bad = withValue(withValue(payloadOf('pull_request'), 'repository.id', secret), 'installation.id', secret);
  expect(() => routeWebhook('pull_request', 'opened', bad, CONTEXT)).toThrow(ZodError);
  try {
    routeWebhook('pull_request', 'opened', bad, CONTEXT);
  } catch (error) {
    expect(error instanceof ZodError ? sorted(error.issues.map((issue) => issue.path.join('.'))) : []).toEqual([
      'installation.id',
      'repository.id',
    ]);
  }
});

// A payload read by `JSON.parse`, the way the route has it: `__proto__` and `constructor` are ordinary own keys there.
test.each(['__proto__', 'constructor', 'prototype', 'toString'])(
  'a %s key at any depth is dropped and pollutes nothing',
  (key) => {
    const before = prototypeNames();
    const text = JSON.stringify(payloadOf('pull_request'));
    const hostile = text
      .replace('{"action"', `{${JSON.stringify(key)}:{"polluted":true,"id":1},"action"`)
      .replace('"head"', `${JSON.stringify(key)}:{"polluted":true},"head"`)
      .replace('"installation":{', `"installation":{${JSON.stringify(key)}:{"polluted":true},`);
    expect(hostile.split(JSON.stringify(key))).toHaveLength(4);
    const parsed: unknown = JSON.parse(hostile);
    const routing = routeWebhook('pull_request', 'opened', parsed, CONTEXT);
    expect(routing).toEqual({ kind: 'job', job: JOBS.evaluatePr });
    expect(Reflect.get({}, 'polluted')).toBeUndefined();
    expect(prototypeNames()).toEqual(before);
  },
);

test('duplicate keys in the JSON: the last one wins, as JSON.parse reads them, and so does the router', () => {
  const text = `{"action":"opened","installation":{"id":1,"id":${IDS.installation}},"repository":{"id":${IDS.repository}},"pull_request":{"number":${IDS.pullRequestNumber}}}`;
  const routing = routeWebhook('pull_request', 'opened', JSON.parse(text), CONTEXT);
  expect(routing).toEqual({ kind: 'job', job: JOBS.evaluatePr });
});

test.each(['ping', 'push', 'repository', 'constructor'])('the payload of %s is never read', (event) => {
  const touched: string[] = [];
  const watcher = new Proxy(
    {},
    {
      get: (_target, key) => touched.push(String(key)),
      has: (_target, key) => touched.push(String(key)) > 0,
      ownKeys: () => {
        touched.push('ownKeys');
        return [];
      },
    },
  );
  routeWebhook(event, 'opened', watcher, CONTEXT);
  expect(touched).toEqual([]);
});

/** Freezes `value` and everything it holds, so that any write to it throws in strict mode. */
function deepFreeze(value: unknown): void {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
}

test.each(SUBSCRIBED_EVENTS)('routing a %s changes nothing, and the same delivery gives the same answer', (event) => {
  const payload = payloadOf(event);
  deepFreeze(payload);
  const first = routeWebhook(event, 'closed', payload, CONTEXT);
  const second = routeWebhook(event, 'closed', payload, CONTEXT);
  expect(second).toEqual(first);
  expect(payload).toEqual(payloadOf(event));
  if (first.kind === 'job') {
    expect(first.job).not.toBe(second.kind === 'job' ? second.job : undefined);
  }
});

test('the delivery id of the context is the one the job carries, and the only thing that differs between two deliveries', () => {
  const other = { appId: CONTEXT.appId, deliveryId: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' };
  const one = routeWebhook('pull_request', 'opened', payloadOf('pull_request'), CONTEXT);
  const two = routeWebhook('pull_request', 'opened', payloadOf('pull_request'), other);
  expect(two).toEqual({ kind: 'job', job: { ...JOBS.evaluatePr, deliveryId: other.deliveryId } });
  expect(one).toEqual({ kind: 'job', job: JOBS.evaluatePr });
});

test('ids at the top of the safe range are carried as they are', () => {
  const big = Number.MAX_SAFE_INTEGER;
  const payload = withValue(withValue(payloadOf('pull_request'), 'installation.id', big), 'repository.id', big - 1);
  expect(routeWebhook('pull_request', 'opened', payload, CONTEXT)).toEqual({
    kind: 'job',
    job: { ...JOBS.evaluatePr, githubInstallationId: big, githubRepoId: big - 1 },
  });
});
