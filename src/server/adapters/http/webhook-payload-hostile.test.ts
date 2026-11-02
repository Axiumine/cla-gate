// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  FIXTURE_IDS,
  FIXTURE_SHA,
  prototypeNames,
  sorted,
  webhookFixture,
  withRawJson,
  withValue,
} from '../github/webhook-fixture/test-support.ts';
import { envelopeOf, payloadInvalid, recordingLog, thrownBy } from './test-support.ts';
import { checkPayload } from './webhook-payload.ts';

// The hostile payload table of E06-S03. Every body is text, as it arrives: `JSON.stringify` cannot write `1e400`, an
// integer past 2**53 or a repeated key, and the envelope (`envelopeOf`) parses it the way the route does.

const pullRequest = webhookFixture('pull_request');
const issueComment = webhookFixture('issue_comment');
const checkRun = webhookFixture('check_run');
const json = JSON.stringify;

/** `payload` as JSON text with `tail` (`"key":value` pairs) written after its last member: a repeated key stays repeated. */
function withTail(payload: Record<string, unknown>, tail: string): string {
  return `${json(payload).slice(0, -1)},${tail}}`;
}

function run(event: string, body: string) {
  const log = recordingLog();
  return { log, outcome: () => checkPayload(envelopeOf(event, body), log) };
}

/** The payload a `pull_request` delivery of `body` comes back with. */
function pullRequestPayload(body: string) {
  const delivery = run('pull_request', body).outcome();
  if (delivery?.event !== 'pull_request') {
    throw new Error('the delivery did not come back as a pull_request');
  }
  return delivery.payload;
}

const REFUSED: readonly (readonly [string, string, string, readonly string[]])[] = [
  ['an id as a string', 'pull_request', json(withValue(pullRequest, 'installation.id', '31001')), ['installation.id']],
  ['an id as a float', 'pull_request', json(withValue(pullRequest, 'repository.id', 1.5)), ['repository.id']],
  ['a negative id', 'pull_request', json(withValue(pullRequest, 'repository.id', -52_002)), ['repository.id']],
  ['an id of 0', 'pull_request', json(withValue(pullRequest, 'repository.id', 0)), ['repository.id']],
  ['an id of -0', 'pull_request', withRawJson(pullRequest, 'repository.id', '-0'), ['repository.id']],
  [
    'an id of 2**53',
    'pull_request',
    withRawJson(pullRequest, 'pull_request.user.id', '9007199254740992'),
    ['pull_request.user.id'],
  ],
  [
    'an id of 1e400 (Infinity once parsed)',
    'pull_request',
    withRawJson(pullRequest, 'installation.id', '1e400'),
    ['installation.id'],
  ],
  [
    'an id as a 20-digit string',
    'pull_request',
    withRawJson(pullRequest, 'repository.id', '"12345678901234567890"'),
    ['repository.id'],
  ],
  [
    'an id as a 20-digit number',
    'pull_request',
    withRawJson(pullRequest, 'repository.id', '12345678901234567890'),
    ['repository.id'],
  ],
  ['an id as a boolean', 'pull_request', json(withValue(pullRequest, 'installation.id', true)), ['installation.id']],
  ['a missing installation', 'pull_request', json(withValue(pullRequest, 'installation', undefined)), ['installation']],
  ['installation as null', 'pull_request', withRawJson(pullRequest, 'installation', 'null'), ['installation']],
  [
    'installation as an array',
    'pull_request',
    withRawJson(pullRequest, 'installation', '[{"id":31001}]'),
    ['installation'],
  ],
  [
    'an id smuggled in through __proto__',
    'pull_request',
    withRawJson(pullRequest, 'installation', '{"__proto__":{"id":31001}}'),
    ['installation.id'],
  ],
  [
    'an id smuggled in through constructor',
    'pull_request',
    withRawJson(pullRequest, 'installation', '{"constructor":{"prototype":{"id":31001}}}'),
    ['installation.id'],
  ],
  [
    'pull_request as a string',
    'pull_request',
    json(withValue(pullRequest, 'pull_request', 'opened')),
    ['pull_request'],
  ],
  ['pull_request as an array', 'pull_request', withRawJson(pullRequest, 'pull_request', '[]'), ['pull_request']],
  [
    'pull_request.head as null',
    'pull_request',
    withRawJson(pullRequest, 'pull_request.head', 'null'),
    ['pull_request.head'],
  ],
  [
    'a NUL in comment.body',
    'issue_comment',
    json(withValue(issueComment, 'comment.body', 'a\u0000b /recheck')),
    ['comment.body'],
  ],
  [
    'a lone surrogate in comment.body',
    'issue_comment',
    json(withValue(issueComment, 'comment.body', 'a\ud800b /recheck')),
    ['comment.body'],
  ],
  [
    'a comment.body of 65,537 characters',
    'issue_comment',
    json(withValue(issueComment, 'comment.body', 'a'.repeat(65_537))),
    ['comment.body'],
  ],
  ['a NUL in the action', 'pull_request', json(withValue(pullRequest, 'action', 'open\u0000ed')), ['action']],
  [
    'a lone surrogate in the action',
    'pull_request',
    json(withValue(pullRequest, 'action', 'open\udfffed')),
    ['action'],
  ],
  ['an action of 65 characters', 'pull_request', json(withValue(pullRequest, 'action', 'a'.repeat(65))), ['action']],
  ['an action of 1 MiB', 'pull_request', json(withValue(pullRequest, 'action', 'a'.repeat(1_048_576))), ['action']],
  ['an action of null', 'pull_request', withRawJson(pullRequest, 'action', 'null'), ['action']],
  [
    'a head sha in upper case',
    'check_run',
    json(withValue(checkRun, 'check_run.head_sha', FIXTURE_SHA.toUpperCase())),
    ['check_run.head_sha'],
  ],
  [
    'a head sha of 39 digits',
    'check_run',
    json(withValue(checkRun, 'check_run.head_sha', FIXTURE_SHA.slice(1))),
    ['check_run.head_sha'],
  ],
  [
    'a head sha with a trailing newline',
    'check_run',
    json(withValue(checkRun, 'check_run.head_sha', `${FIXTURE_SHA}\n`)),
    ['check_run.head_sha'],
  ],
  [
    'a head sha that is not hexadecimal',
    'check_run',
    json(withValue(checkRun, 'check_run.head_sha', 'z'.repeat(40))),
    ['check_run.head_sha'],
  ],
  [
    'a repeated key where the last one is wrong',
    'pull_request',
    withTail(withValue(pullRequest, 'installation', undefined), '"installation":{"id":31001},"installation":{"id":0}'),
    ['installation.id'],
  ],
  [
    'the event header pull_request over an issue_comment body',
    'pull_request',
    json(issueComment),
    ['number', 'pull_request'],
  ],
  ['the event header issue_comment over a pull_request body', 'issue_comment', json(pullRequest), ['issue', 'comment']],
  [
    'the event header check_run over a check_suite body',
    'check_run',
    json(webhookFixture('check_suite')),
    ['check_run'],
  ],
  ['an empty object for any event', 'installation', '{}', ['action', 'installation']],
];

test.each(REFUSED)('%s is a 400 naming only the failed paths', (_label, event, body, paths) => {
  const { log, outcome } = run(event, body);
  expect(thrownBy(outcome)).toMatchObject(payloadInvalid(paths));
  expect(log.info).toHaveBeenCalledExactlyOnceWith({ event, paths }, 'webhook.payload_invalid');
});

test('a table of at least 25 hostile rows', () => {
  expect(REFUSED.length).toBeGreaterThanOrEqual(25);
});

test('a repeated key: the last one wins, as JSON.parse has it', () => {
  const body = withTail(
    withValue(pullRequest, 'repository', undefined),
    '"repository":{"id":1},"repository":{"id":52002}',
  );
  expect(pullRequestPayload(body).repository).toEqual({ id: FIXTURE_IDS.repository });
});

test('__proto__ and constructor keys are stripped, and Object.prototype is left as it was', () => {
  const before = prototypeNames();
  const polluted = '{"polluted":true,"id":31001,"prototype":{"polluted":true}}';
  const body = json(pullRequest).replace(
    '"installation":{',
    `"__proto__":${polluted},"constructor":{"prototype":${polluted}},"installation":{"__proto__":${polluted},"constructor":${polluted},`,
  );
  expect(body).toContain('"__proto__":{"polluted":true');
  const payload = pullRequestPayload(body);
  expect(sorted(Object.keys(payload))).toEqual(['action', 'installation', 'number', 'pull_request', 'repository']);
  expect(Object.hasOwn(payload, '__proto__')).toBe(false);
  expect(Object.hasOwn(payload, 'constructor')).toBe(false);
  expect(Object.keys(payload.installation)).toEqual(['id']);
  expect(Reflect.getPrototypeOf(payload)).toBe(Reflect.getPrototypeOf({}));
  expect(Reflect.getPrototypeOf(payload.installation)).toBe(Reflect.getPrototypeOf({}));
  expect(Reflect.get({}, 'polluted')).toBeUndefined();
  expect(prototypeNames()).toEqual(before);
});

// Built at run time: a bidi control character written into the source would be a trojan-source hazard in this very file.
const RTL_OVERRIDE = String.fromCodePoint(0x202e);

const ODD_TEXT = [
  ['an RTL override', `fixture${RTL_OVERRIDE}org/fixture-repo`],
  ['a NUL', 'fixture-org/\u0000fixture-repo'],
  ['a lone surrogate', 'fixture-org/\ud800fixture-repo'],
] as const;

test.each(ODD_TEXT)('%s in repository.full_name is accepted and gone: the field is not declared', (_label, name) => {
  const body = json(withValue(pullRequest, 'repository.full_name', name));
  expect(pullRequestPayload(body).repository).toEqual({ id: FIXTURE_IDS.repository });
});

test('an RTL override in comment.body is text, not an attack on a parser: accepted as it was written', () => {
  const text = `please ${RTL_OVERRIDE}deehcer/ this`;
  const delivery = run('issue_comment', json(withValue(issueComment, 'comment.body', text))).outcome();
  expect(delivery?.payload).toMatchObject({ comment: { body: text } });
});

test('100,000 levels of nesting under a key nobody declared are never walked: accepted and stripped', () => {
  const depth = 100_000;
  const nested = `${'{"a":'.repeat(depth)}1${'}'.repeat(depth)}`;
  const body = withTail(pullRequest, `"deep":${nested}`);
  expect(pullRequestPayload(body)).not.toHaveProperty('deep');
});

test('a megabyte under a key nobody declared is dropped: accepted and stripped', () => {
  const body = withTail(pullRequest, `"padding":"${'x'.repeat(1_048_576)}"`);
  expect(json(pullRequestPayload(body)).length).toBeLessThan(1000);
});
