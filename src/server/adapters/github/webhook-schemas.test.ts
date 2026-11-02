// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { ABSENT, FIXTURE_IDS, FIXTURE_SHA, sorted, webhookFixture, withValue } from './webhook-fixture/test-support.ts';
import { hasPayloadSchema, webhookDeliverySchema } from './webhook-schemas.ts';

const EVENTS = webhookDeliverySchema.options.map((option) => option.shape.event.value);

const repository = { id: FIXTURE_IDS.repository };
const installation = { id: FIXTURE_IDS.installation };
const app = { id: FIXTURE_IDS.app };
const account = { id: FIXTURE_IDS.account, type: 'Organization' };

// What each fixture leaves after parsing: the declared fields and nothing else. A field kept by mistake (a login, a
// title, a URL, a repository name) makes the comparison fail, and so does a declared field that is lost.
const KEPT = [
  [
    'pull_request',
    {
      action: 'opened',
      number: 7,
      pull_request: { number: 7, head: { sha: FIXTURE_SHA }, user: { id: FIXTURE_IDS.author, type: 'User' } },
      repository,
      installation,
    },
  ],
  [
    'check_run',
    {
      action: 'rerequested',
      check_run: { id: FIXTURE_IDS.checkRun, name: 'license/cla', head_sha: FIXTURE_SHA, app },
      repository,
      installation,
    },
  ],
  [
    'check_suite',
    {
      action: 'rerequested',
      check_suite: { id: FIXTURE_IDS.checkSuite, head_sha: FIXTURE_SHA, app },
      repository,
      installation,
    },
  ],
  [
    'issue_comment',
    {
      action: 'created',
      issue: { number: 7, pull_request: {} },
      comment: { id: FIXTURE_IDS.comment, body: 'Please /recheck this one.' },
      sender: { type: 'User' },
      repository,
      installation,
    },
  ],
  ['installation', { action: 'created', installation: { id: FIXTURE_IDS.installation, account } }],
  ['installation_repositories', { action: 'added', installation: { id: FIXTURE_IDS.installation, account } }],
  ['github_app_authorization', { action: 'revoked', sender: { id: FIXTURE_IDS.sender } }],
] as const;

test.each(KEPT)('the %s fixture is accepted and keeps only the declared fields', (event, kept) => {
  const result = webhookDeliverySchema.safeParse({ event, payload: webhookFixture(event) });
  expect(result.success).toBe(true);
  expect(result.data).toEqual({ event, payload: kept });
});

test('the supported events are the seven the App subscribes to, each with a kept-fields row above', () => {
  expect(sorted(EVENTS)).toEqual(sorted(KEPT.map(([event]) => event)));
  expect(EVENTS).toHaveLength(7);
});

test.each(EVENTS)('an action nobody handles still validates for %s (the router ignores it, E06-S04)', (event) => {
  const payload = withValue(webhookFixture(event), 'action', 'a_future_action');
  expect(webhookDeliverySchema.safeParse({ event, payload }).success).toBe(true);
});

test.each([
  ['pull_request', 'repository.id'],
  ['pull_request', 'installation.id'],
  ['pull_request', 'pull_request.user.id'],
  ['check_run', 'check_run.app.id'],
  ['check_suite', 'check_suite.id'],
  ['installation', 'installation.account.id'],
  ['github_app_authorization', 'sender.id'],
] as const)('%s reads %s as the largest safe integer and refuses the next one', (event, path) => {
  const accepted = withValue(webhookFixture(event), path, Number.MAX_SAFE_INTEGER);
  expect(webhookDeliverySchema.safeParse({ event, payload: accepted }).success).toBe(true);
  const refused = withValue(webhookFixture(event), path, Number.MAX_SAFE_INTEGER + 1);
  expect(webhookDeliverySchema.safeParse({ event, payload: refused }).success).toBe(false);
});

test('the comment body may be 65,536 characters and not one more', () => {
  const body = (length: number) => withValue(webhookFixture('issue_comment'), 'comment.body', 'a'.repeat(length));
  expect(webhookDeliverySchema.safeParse({ event: 'issue_comment', payload: body(65_536) }).success).toBe(true);
  expect(webhookDeliverySchema.safeParse({ event: 'issue_comment', payload: body(65_537) }).success).toBe(false);
});

test('issue.pull_request is optional: an issue comment on a plain issue has none, and none is kept', () => {
  const plain = withValue(webhookFixture('issue_comment'), 'issue.pull_request', ABSENT);
  const result = webhookDeliverySchema.safeParse({ event: 'issue_comment', payload: plain });
  expect(result.success).toBe(true);
  expect(result.data).toMatchObject({ payload: { issue: { number: 7 } } });
  expect(result.data?.payload).not.toHaveProperty('issue.pull_request');
});

test.each([
  ['pull_request', true],
  ['check_run', true],
  ['check_suite', true],
  ['issue_comment', true],
  ['installation', true],
  ['installation_repositories', true],
  ['github_app_authorization', true],
  ['ping', false],
  ['push', false],
  ['constructor', false],
  ['__proto__', false],
  ['toString', false],
])('%s has a payload schema: %s', (event, has) => {
  expect(hasPayloadSchema(event)).toBe(has);
});

test.each(EVENTS)('the %s fixture holds no email address and no token', (event) => {
  expect(JSON.stringify(webhookFixture(event))).not.toMatch(/@|ghp_|gho_|ghs_|github_pat_|-----BEGIN/);
});
