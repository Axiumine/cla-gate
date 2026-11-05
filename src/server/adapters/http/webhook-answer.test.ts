// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { IGNORE_REASONS, REDIRECT_REASONS, type Routing } from '../../domain/webhook-routing-types.ts';
import type { AdmittedRouting } from '../../domain/webhook-tenant.ts';
import { FIXTURE_IDS, type WebhookEvent, webhookFixture } from '../github/webhook-fixture/test-support.ts';
import { webhookDeliverySchema } from '../github/webhook-schemas.ts';
import { envelopeOf } from './test-support.ts';
import { answerFor, type RecordDelivery, routeDelivery, webhookResponseSchemas } from './webhook-answer.ts';

// The glue between the checked delivery and the routing table (E06-S04): what the router is given and what is answered.

const APP_ID = String(FIXTURE_IDS.app);

const EVENTS: readonly WebhookEvent[] = [
  'pull_request',
  'check_run',
  'check_suite',
  'issue_comment',
  'merge_group',
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

const JOB: Extract<Routing, { kind: 'job' }> = {
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

/** A recording that answers `outcome` to a job and to a group taken down, and keeps what it was asked. */
function recording(outcome: 'accepted' | 'duplicate') {
  const job = vi.fn<RecordDelivery['job']>(() => Promise.resolve(outcome));
  const destroyed = vi.fn<RecordDelivery['destroyed']>(() => Promise.resolve(outcome));
  return { job, destroyed, record: { job, destroyed } satisfies RecordDelivery };
}

const accepted = recording('accepted').record;
const duplicate = recording('duplicate').record;

test('a job recorded now is a 202 accepted, and says nothing of the job', async () => {
  expect(await answerFor(JOB, accepted)).toEqual({ statusCode: 202, body: { status: 'accepted' } });
});

test('a job already recorded is a 200 duplicate', async () => {
  expect(await answerFor(JOB, duplicate)).toEqual({ statusCode: 200, body: { status: 'duplicate' } });
});

test('the job that is recorded is the one the delivery became, and it is recorded once', async () => {
  const { job, destroyed, record } = recording('accepted');
  await answerFor(JOB, record);
  expect(job.mock.calls).toEqual([[JOB.job]]);
  expect(destroyed).not.toHaveBeenCalled();
});

test('a failed recording is not caught here: the route turns it into a 503', async () => {
  const failure = new Error('the send failed');
  const failing = { job: () => Promise.reject(failure), destroyed: () => Promise.reject(failure) };
  await expect(answerFor(JOB, failing)).rejects.toBe(failure);
  await expect(answerFor(DESTROYED, failing)).rejects.toBe(failure);
});

const DESTROYED: Extract<AdmittedRouting, { kind: 'destroyed' }> = {
  kind: 'destroyed',
  group: {
    githubInstallationId: parseGithubId(1),
    githubRepoId: parseGithubId(2),
    headSha: 'a'.repeat(40),
    baseSha: 'c'.repeat(40),
    deliveryId: 'b'.repeat(8),
  },
};

test('a merge group taken down is recorded as such, with no job, and answered like a job', async () => {
  const fresh = recording('accepted');
  expect(await answerFor(DESTROYED, fresh.record)).toEqual({ statusCode: 202, body: { status: 'accepted' } });
  expect(fresh.destroyed.mock.calls).toEqual([[DESTROYED.group]]);
  expect(fresh.job).not.toHaveBeenCalled();
  expect(await answerFor(DESTROYED, duplicate)).toEqual({ statusCode: 200, body: { status: 'duplicate' } });
});

test('a ping is answered with 200 pong and records nothing', async () => {
  const { job, destroyed, record } = recording('accepted');
  expect(await answerFor({ kind: 'pong' }, record)).toEqual({ statusCode: 200, body: { status: 'pong' } });
  expect(job).not.toHaveBeenCalled();
  expect(destroyed).not.toHaveBeenCalled();
});

test.each(IGNORE_REASONS)(
  'an ignored delivery (%s) is a 202 that names the reason and nothing else, and records nothing',
  async (reason) => {
    const { job, destroyed, record } = recording('accepted');
    expect(await answerFor({ kind: 'ignored', reason }, record)).toEqual({
      statusCode: 202,
      body: { status: 'ignored', reason },
    });
    expect(job).not.toHaveBeenCalled();
    expect(destroyed).not.toHaveBeenCalled();
  },
);

/** The delivery of a pull request of an installation nobody stored, replaced by the sync of that installation (E06-S05). */
function redirected(reason: (typeof REDIRECT_REASONS)[number]): Extract<AdmittedRouting, { kind: 'redirected' }> {
  const job = checkedJob();
  if (job.type !== 'sync-installation') {
    throw new Error('the installation fixture is a sync-installation job');
  }
  return { kind: 'redirected', reason, job };
}

test.each(REDIRECT_REASONS)(
  'a delivery replaced by a sync (%s) is recorded as the sync and answered 202 with the reason, not the sync or the installation',
  async (reason) => {
    const replaced = redirected(reason);
    const { job, record } = recording('accepted');
    expect(await answerFor(replaced, record)).toEqual({ statusCode: 202, body: { status: 'ignored', reason } });
    expect(job.mock.calls).toEqual([[replaced.job]]);
  },
);

test.each(REDIRECT_REASONS)(
  'a delivery replaced by a sync (%s) that was recorded before is a 200 duplicate',
  async (reason) => {
    expect(await answerFor(redirected(reason), duplicate)).toEqual({ statusCode: 200, body: { status: 'duplicate' } });
  },
);

const EVERY_ANSWER: readonly (readonly [AdmittedRouting, RecordDelivery])[] = [
  [JOB, accepted],
  [JOB, duplicate],
  [DESTROYED, accepted],
  [DESTROYED, duplicate],
  [{ kind: 'pong' }, accepted],
  ...IGNORE_REASONS.map((reason): readonly [AdmittedRouting, RecordDelivery] => [
    { kind: 'ignored', reason },
    accepted,
  ]),
  ...REDIRECT_REASONS.map((reason): readonly [AdmittedRouting, RecordDelivery] => [redirected(reason), accepted]),
  ...REDIRECT_REASONS.map((reason): readonly [AdmittedRouting, RecordDelivery] => [redirected(reason), duplicate]),
];

test.each(EVERY_ANSWER)('every answer fits the response schema of its status code', async (routing, record) => {
  const answer = await answerFor(routing, record);
  expect(webhookResponseSchemas[answer.statusCode].safeParse(answer.body).success).toBe(true);
});

test('the response schemas refuse an ignore reason that is not a constant of this server', () => {
  expect(
    webhookResponseSchemas[202].safeParse({ status: 'ignored', reason: 'whatever the sender wrote' }).success,
  ).toBe(false);
  expect(webhookResponseSchemas[202].safeParse({ status: 'ignored' }).success).toBe(false);
  expect(webhookResponseSchemas[200].safeParse({ status: 'accepted' }).success).toBe(false);
  expect(webhookResponseSchemas[202].safeParse({ status: 'duplicate' }).success).toBe(false);
  expect(webhookResponseSchemas[200].safeParse({ status: 'verified' }).success).toBe(false);
});
