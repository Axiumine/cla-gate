// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { AUDIT_ACTIONS, INSTANCE_ACTIONS, SYSTEM_ACTIONS } from '../../shared/audit.ts';
import { type AuditEntry, AuditEntryInvalid, toAuditRow } from './audit-entry.ts';
import { ACTOR, tenantEntry, unchecked } from './test-support.ts';

const COMBINATIONS = AUDIT_ACTIONS.flatMap((action) =>
  [true, false].flatMap((installation) => [true, false].map((actor) => ({ action, installation, actor }))),
);

test.each(COMBINATIONS)(
  'action $action with installation $installation and actor $actor',
  ({ action, installation, actor }) => {
    const entry = unchecked({ action, installationId: installation ? 5 : null, actorGithubId: actor ? ACTOR : null });
    const tenantOk = installation || INSTANCE_ACTIONS.has(action);
    const actorOk = actor || SYSTEM_ACTIONS.has(action);
    if (tenantOk && actorOk) {
      expect(toAuditRow(entry)).toMatchObject({ action });
      return;
    }
    const field = tenantOk ? 'actorGithubId' : 'installationId';
    expect(() => toAuditRow(entry)).toThrow(AuditEntryInvalid);
    expect(() => toAuditRow(entry)).toThrow(field);
  },
);

test('a tenant action with a null installation fails and says why', () => {
  expect(() => toAuditRow(tenantEntry(5, { installationId: null }))).toThrow(
    'invalid audit entry: installationId (a tenant action needs an installation)',
  );
});

test('a human action with a null actor fails and says why', () => {
  expect(() => toAuditRow(tenantEntry(5, { actorGithubId: null }))).toThrow(
    'invalid audit entry: actorGithubId (only a system action may have no actor)',
  );
});

test('an instance action may carry a tenant, and a system action may carry an actor', () => {
  expect(toAuditRow({ action: 'network_metadata.purged', installationId: 5, actorGithubId: ACTOR })).toMatchObject({
    installation_id: 5,
    actor_github_id: ACTOR,
  });
});

test('the row has the columns of audit_log and an empty metadata object by default', () => {
  expect(toAuditRow(tenantEntry(5))).toEqual({
    installation_id: 5,
    actor_github_id: ACTOR,
    action: 'repository.enabled',
    subject_type: null,
    subject_id: null,
    metadata: '{}',
  });
});

test('subject and metadata are carried, and the metadata is the parsed copy as JSON text in the order of the key list', () => {
  const row = toAuditRow(
    tenantEntry(5, { subject: { type: 'repository', id: 9000 }, metadata: { repository_id: 3, document_id: 4 } }),
  );
  expect(row).toMatchObject({ subject_type: 'repository', subject_id: 9000 });
  expect(row.metadata).toBe('{"document_id":4,"repository_id":3}');
});

const HOSTILE = 'alice@example.com';

/** The message of the AuditEntryInvalid that `toAuditRow` throws for `entry`. */
function refusalOf(entry: AuditEntry): string {
  try {
    toAuditRow(entry);
  } catch (error) {
    expect(error).toBeInstanceOf(AuditEntryInvalid);
    return error instanceof Error ? error.message : '';
  }
  return expect.unreachable('toAuditRow accepted the entry');
}
const LONG_LIST = Array.from({ length: 100 }, () => 11_111_111_111_111);
const OVERSIZE = { rows: LONG_LIST, sessions: LONG_LIST };

test.each([
  ['an action outside the closed set', { action: 'user.deleted' }, 'action (invalid_value)', 'user.deleted'],
  ['an address as the action', { action: HOSTILE }, 'action (invalid_value)', HOSTILE],
  ['an installation id of zero', { installationId: 0 }, 'installationId (too_small)', '(0)'],
  ['a negative installation id', { installationId: -3 }, 'installationId (too_small)', '-3'],
  ['a fractional installation id', { installationId: 1.5 }, 'installationId (invalid_type)', '1.5'],
  ['a text installation id', { installationId: HOSTILE }, 'installationId (invalid_type)', HOSTILE],
  ['an actor id of zero', { actorGithubId: 0 }, 'actorGithubId (too_small)', '(0)'],
  ['a text actor id', { actorGithubId: HOSTILE }, 'actorGithubId (invalid_type)', HOSTILE],
  ['a subject type with an address', { subject: { type: HOSTILE, id: 1 } }, 'subject.type (invalid_format)', HOSTILE],
  ['a subject id of zero', { subject: { type: 'user', id: 0 } }, 'subject.id (too_small)', '(0)'],
  ['an extra field on the subject', { subject: { type: 'user', id: 1, login: HOSTILE } }, 'subject.login', HOSTILE],
  ['an extra field on the entry', { email: HOSTILE }, 'email (unrecognized_keys)', HOSTILE],
  ['a personal key in the metadata', { metadata: { email: HOSTILE } }, 'metadata.email (unrecognized_keys)', HOSTILE],
  ['an address as a metadata key', { metadata: { [HOSTILE]: 1 } }, 'metadata.? (unrecognized_keys)', HOSTILE],
  ['an address as a metadata value', { metadata: { reason_code: HOSTILE } }, 'metadata.reason_code', HOSTILE],
  ['a list of addresses', { metadata: { rows: [HOSTILE] } }, 'metadata.rows', HOSTILE],
  [
    'metadata over 2,048 bytes',
    { metadata: OVERSIZE },
    'metadata (audit metadata is longer than 2048 bytes)',
    '1111111',
  ],
  ['metadata that is not an object', { metadata: HOSTILE }, 'metadata (invalid_type)', HOSTILE],
])('%s is refused without repeating its value', (_name, change, expected, hostile) => {
  const message = refusalOf(unchecked({ ...tenantEntry(5), ...change }));
  expect(message).toContain(expected);
  expect(message).not.toContain(hostile);
});

test.each([[null], ['repository.enabled'], [[]]])('%j is not an entry at all', (value) => {
  expect(() => toAuditRow(unchecked(value))).toThrow('invalid audit entry: entry (invalid_type)');
});

test('several problems are all named, in one message', () => {
  const entry = unchecked({ ...tenantEntry(0), metadata: { name: 'A', count: 'B C' } });
  expect(refusalOf(entry)).toBe(
    'invalid audit entry: installationId (too_small); metadata.count (invalid_format); metadata.name (unrecognized_keys)',
  );
});

test('the error is an AuditEntryInvalid named so', () => {
  const error = new AuditEntryInvalid('x');
  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe('AuditEntryInvalid');
});
