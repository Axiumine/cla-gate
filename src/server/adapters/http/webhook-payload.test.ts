// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { z } from 'zod';
import {
  ABSENT,
  FIXTURE_IDS,
  sorted,
  type WebhookEvent,
  webhookFixture,
  withValue,
} from '../github/webhook-fixture/test-support.ts';
import { webhookDeliverySchema } from '../github/webhook-schemas.ts';
import { AppError } from './errors.ts';
import { envelopeOf, payloadInvalid, recordingLog, thrownBy } from './test-support.ts';
import { checkPayload } from './webhook-payload.ts';

/** The envelope of `payload` as the route has it, and a logger that remembers what was logged. */
function run(event: string, payload: unknown) {
  const log = recordingLog();
  const outcome = () => checkPayload(envelopeOf(event, JSON.stringify(payload)), log);
  return { log, outcome };
}

function asSchema(value: unknown): z.ZodType {
  if (value instanceof z.ZodType) {
    return value;
  }
  throw new Error('a member of a shape is not a schema');
}

/** Every field of the payload schema that is not an object with fields of its own, as a dotted path. */
function leafPaths(schema: z.ZodType, prefix = ''): string[] {
  const inner = schema instanceof z.ZodOptional ? schema.unwrap() : schema;
  if (!(inner instanceof z.ZodObject) || Object.keys(inner.shape).length === 0) {
    return [prefix];
  }
  return Object.entries<unknown>(inner.shape).flatMap(([key, child]) =>
    leafPaths(asSchema(child), prefix === '' ? key : `${prefix}.${key}`),
  );
}

// One row per field of every schema: the value of the wrong type that field must refuse. Removing a field from a schema
// makes its row pass instead of fail, and the test after the table fails when a schema gains a field with no row.
const WRONG_TYPE: readonly (readonly [WebhookEvent, string, unknown])[] = [
  ['pull_request', 'action', 7],
  ['pull_request', 'number', '7'],
  ['pull_request', 'pull_request.number', '7'],
  ['pull_request', 'pull_request.head.sha', 7],
  ['pull_request', 'pull_request.user.id', '7003'],
  ['pull_request', 'pull_request.user.type', 7],
  ['pull_request', 'repository.id', '52002'],
  ['pull_request', 'installation.id', '31001'],
  ['check_run', 'action', 7],
  ['check_run', 'check_run.id', '61005'],
  ['check_run', 'check_run.name', 7],
  ['check_run', 'check_run.head_sha', 7],
  ['check_run', 'check_run.app.id', '4242'],
  ['check_run', 'repository.id', '52002'],
  ['check_run', 'installation.id', '31001'],
  ['check_suite', 'action', 7],
  ['check_suite', 'check_suite.id', '61006'],
  ['check_suite', 'check_suite.head_sha', 7],
  ['check_suite', 'check_suite.app.id', '4242'],
  ['check_suite', 'repository.id', '52002'],
  ['check_suite', 'installation.id', '31001'],
  ['issue_comment', 'action', 7],
  ['issue_comment', 'issue.number', '7'],
  ['issue_comment', 'issue.pull_request', 'yes'],
  ['issue_comment', 'comment.id', '90004'],
  ['issue_comment', 'comment.body', 7],
  ['issue_comment', 'sender.type', 7],
  ['issue_comment', 'repository.id', '52002'],
  ['issue_comment', 'installation.id', '31001'],
  ['merge_group', 'action', 7],
  ['merge_group', 'merge_group.head_sha', 7],
  ['merge_group', 'merge_group.base_sha', 7],
  ['merge_group', 'merge_group.head_ref', 7],
  ['merge_group', 'repository.id', '52002'],
  ['merge_group', 'installation.id', '31001'],
  ['installation', 'action', 7],
  ['installation', 'installation.id', '31001'],
  ['installation', 'installation.account.id', '8007'],
  ['installation', 'installation.account.type', 7],
  ['installation_repositories', 'action', 7],
  ['installation_repositories', 'installation.id', '31001'],
  ['installation_repositories', 'installation.account.id', '8007'],
  ['installation_repositories', 'installation.account.type', 7],
  ['github_app_authorization', 'action', 7],
  ['github_app_authorization', 'sender.id', '7008'],
];

test.each(WRONG_TYPE)('%s: %s of the wrong type is a 400 naming only that path', (event, path, wrong) => {
  const { log, outcome } = run(event, withValue(webhookFixture(event), path, wrong));
  expect(thrownBy(outcome)).toMatchObject(payloadInvalid([path]));
  expect(log.info).toHaveBeenCalledExactlyOnceWith({ event, paths: [path] }, 'webhook.payload_invalid');
});

test.each(WRONG_TYPE.filter(([, path]) => path !== 'issue.pull_request'))(
  '%s: a missing %s is a 400 naming only that path',
  (event, path) => {
    const { outcome } = run(event, withValue(webhookFixture(event), path, ABSENT));
    expect(thrownBy(outcome)).toMatchObject(payloadInvalid([path]));
  },
);

test('the table has a row for every field of every schema, and no row for a field that is not there', () => {
  const declared = webhookDeliverySchema.options.flatMap((option) =>
    leafPaths(option.shape.payload).map((path) => `${option.shape.event.value} ${path}`),
  );
  expect(sorted(WRONG_TYPE.map(([event, path]) => `${event} ${path}`))).toEqual(sorted(declared));
});

test.each([
  'pull_request',
  'check_run',
  'check_suite',
  'issue_comment',
  'merge_group',
  'installation',
  'installation_repositories',
  'github_app_authorization',
] as const)('a valid %s delivery is returned with its payload stripped and logs nothing', (event) => {
  const { log, outcome } = run(event, webhookFixture(event));
  expect(thrownBy(outcome)).toBeUndefined();
  const delivery = outcome();
  expect(delivery?.event).toBe(event);
  // Every name, title and URL of the fixtures is in a field the schemas do not declare, and contains "ixture".
  expect(JSON.stringify(delivery)).not.toContain('ixture');
  expect(log.info).not.toHaveBeenCalled();
});

test.each(['ping', 'push', 'repository', 'constructor', '__proto__', 'a_b'])(
  'the event %s has no schema: its payload is not read and the delivery comes back undefined',
  (event) => {
    const { log, outcome } = run(event, {
      zen: 'Keep it logically awesome.',
      installation: [1, 'x'],
      action: { not: 'text' },
    });
    expect(outcome()).toBeUndefined();
    expect(log.info).not.toHaveBeenCalled();
  },
);

test('several failures give every path once, in the order of the schema, and the log lists the same paths', () => {
  const broken = withValue(
    withValue(withValue(webhookFixture('pull_request'), 'repository.id', 'x'), 'action', 7),
    'installation',
    [FIXTURE_IDS.installation],
  );
  const { log, outcome } = run('pull_request', broken);
  expect(thrownBy(outcome)).toMatchObject(payloadInvalid(['action', 'repository.id', 'installation']));
  expect(log.info).toHaveBeenCalledWith(
    { event: 'pull_request', paths: ['action', 'repository.id', 'installation'] },
    'webhook.payload_invalid',
  );
});

test('a failure carries no value: not in the error, not in the log call', () => {
  const canary = 'canary-value-4f7a9c';
  const { log, outcome } = run('installation', withValue(webhookFixture('installation'), 'installation.id', canary));
  expect(thrownBy(outcome)).toBeInstanceOf(AppError);
  expect(thrownBy(outcome)).toMatchObject(payloadInvalid(['installation.id']));
  expect(JSON.stringify(log.info.mock.calls)).not.toContain(canary);
});

test('an error that is not a validation failure is not caught: it is the error handler that answers it', () => {
  const failure = new Error('schema bug');
  const spy = vi.spyOn(webhookDeliverySchema, 'safeParse').mockImplementation(() => {
    throw failure;
  });
  const { log, outcome } = run('pull_request', webhookFixture('pull_request'));
  try {
    expect(thrownBy(outcome)).toBe(failure);
    expect(log.info).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});
