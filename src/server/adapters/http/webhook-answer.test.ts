// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { IGNORE_REASONS, type Routing } from '../../domain/webhook-routing-types.ts';
import { FIXTURE_IDS, type WebhookEvent, webhookFixture } from '../github/webhook-fixture/test-support.ts';
import { webhookDeliverySchema } from '../github/webhook-schemas.ts';
import { envelopeOf } from './test-support.ts';
import { answerFor, routeDelivery, webhookResponseSchemas } from './webhook-answer.ts';

// The glue between the checked delivery and the routing table (E06-S04): what the router is given and what is answered.

const APP_ID = String(FIXTURE_IDS.app);

const EVENTS: readonly WebhookEvent[] = [
  'pull_request',
  'check_run',
  'check_suite',
  'issue_comment',
  'installation',
  'installation_repositories',
  'github_app_authorization',
];

/** The delivery as the route has it after the envelope and the event schema: the body is the fixture of `event`. */
function checked(event: WebhookEvent, changes: Record<string, unknown> = {}) {
  const envelope = envelopeOf(event, JSON.stringify({ ...webhookFixture(event), ...changes }));
  return { envelope, delivery: webhookDeliverySchema.parse({ event, payload: envelope.payload }) };
}

// The schemas of E06-S03 and the router's own reading of a payload are written apart: this is where they meet. Every
// fixture that passes the first must be routed by the second, as the job its event is for.
test.each(EVENTS)('the checked %s fixture is routed to a job that carries its delivery id', (event) => {
  const { envelope, delivery } = checked(event);
  const routing = routeDelivery(envelope, delivery, APP_ID);
  expect(routing.kind).toBe('job');
  expect(routing.kind === 'job' ? routing.job.deliveryId : undefined).toBe(envelope.deliveryId);
});

test('the action of the checked payload decides which job a pull request becomes', () => {
  const opened = checked('pull_request');
  const closed = checked('pull_request', { action: 'closed' });
  const labeled = checked('pull_request', { action: 'labeled' });
  expect(routeDelivery(opened.envelope, opened.delivery, APP_ID)).toMatchObject({ job: { type: 'evaluate-pr' } });
  expect(routeDelivery(closed.envelope, closed.delivery, APP_ID)).toMatchObject({ job: { type: 'close-pr' } });
  expect(routeDelivery(labeled.envelope, labeled.delivery, APP_ID)).toEqual({
    kind: 'ignored',
    reason: 'unsupported_action',
  });
});

test('the router is given the configured App id', () => {
  const { envelope, delivery } = checked('check_run');
  expect(routeDelivery(envelope, delivery, APP_ID).kind).toBe('job');
  expect(routeDelivery(envelope, delivery, undefined)).toEqual({ kind: 'ignored', reason: 'foreign_check' });
  expect(routeDelivery(envelope, delivery, String(FIXTURE_IDS.app + 1))).toEqual({
    kind: 'ignored',
    reason: 'foreign_check',
  });
});

test('an event with no schema is routed without a delivery: ping is answered, any other event is ignored', () => {
  expect(routeDelivery(envelopeOf('ping', '{}'), undefined, APP_ID)).toEqual({ kind: 'pong' });
  expect(routeDelivery(envelopeOf('push', '{"ref":"x"}'), undefined, APP_ID)).toEqual({
    kind: 'ignored',
    reason: 'unsupported_event',
  });
});

const JOB: Routing = {
  kind: 'job',
  job: checkedJob(),
};

function checkedJob(): Extract<Routing, { kind: 'job' }>['job'] {
  const { envelope, delivery } = checked('installation');
  const routing = routeDelivery(envelope, delivery, APP_ID);
  if (routing.kind !== 'job') {
    throw new Error('the installation fixture is a job');
  }
  return routing.job;
}

test('a job is acknowledged with 200 verified, and says nothing of the job', () => {
  expect(answerFor(JOB)).toEqual({ statusCode: 200, body: { status: 'verified' } });
});

test('a ping is answered with 200 pong', () => {
  expect(answerFor({ kind: 'pong' })).toEqual({ statusCode: 200, body: { status: 'pong' } });
});

test.each(IGNORE_REASONS)('an ignored delivery (%s) is a 202 that names the reason and nothing else', (reason) => {
  expect(answerFor({ kind: 'ignored', reason })).toEqual({ statusCode: 202, body: { status: 'ignored', reason } });
});

test.each([JOB, { kind: 'pong' } as const, ...IGNORE_REASONS.map((reason) => ({ kind: 'ignored', reason }) as const)])(
  'every answer fits the response schema of its status code',
  (routing) => {
    const answer = answerFor(routing);
    expect(webhookResponseSchemas[answer.statusCode].safeParse(answer.body).success).toBe(true);
  },
);

test('the response schemas refuse an ignore reason that is not a constant of the router', () => {
  expect(
    webhookResponseSchemas[202].safeParse({ status: 'ignored', reason: 'whatever the sender wrote' }).success,
  ).toBe(false);
  expect(webhookResponseSchemas[202].safeParse({ status: 'ignored' }).success).toBe(false);
  expect(webhookResponseSchemas[200].safeParse({ status: 'accepted' }).success).toBe(false);
});
