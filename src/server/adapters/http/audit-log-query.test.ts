// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { AUDIT_ACTIONS } from '../../../shared/audit.ts';
import { AUDIT_LOG_DEFAULT_LIMIT, AUDIT_LOG_MAX_LIMIT } from '../../../shared/audit-log.ts';
import { encodeAuditCursor } from '../../domain/audit-cursor.ts';
import { auditLogQuerySchema } from './audit-log-query.ts';

// The query string of the audit log viewer (E16-S02), as the route's schema reads it.

const parse = (query: Record<string, unknown>) => auditLogQuerySchema.safeParse(query);

test('a request with no parameter asks for the first page of the default size', () => {
  expect(parse({})).toMatchObject({ success: true, data: { limit: AUDIT_LOG_DEFAULT_LIMIT } });
  expect(AUDIT_LOG_DEFAULT_LIMIT).toBe(50);
  expect(AUDIT_LOG_MAX_LIMIT).toBe(200);
});

test('every parameter is read into the value the data function takes', () => {
  const cursor = { occurredAt: '2026-11-02T10:00:00.123456Z', id: 9 };
  const parsed = parse({
    action: 'repository.enabled',
    actorGithubId: '1234',
    subjectType: 'repository',
    subjectId: '56',
    from: '2026-11-01T00:00:00Z',
    to: '2026-11-02T02:00:00.250+02:00',
    limit: '200',
    cursor: encodeAuditCursor(cursor),
  });
  expect(parsed.data).toEqual({
    action: 'repository.enabled',
    actorGithubId: 1234,
    subjectType: 'repository',
    subjectId: 56,
    from: new Date('2026-11-01T00:00:00.000Z'),
    to: new Date('2026-11-02T00:00:00.250Z'),
    limit: 200,
    cursor,
  });
});

test.each(AUDIT_ACTIONS)('the action %s is accepted', (action) => {
  expect(parse({ action }).success).toBe(true);
});

test.each([
  ['an action that is not in the catalogue', { action: 'signature.deleted' }],
  ['an action in the wrong case', { action: 'Repository.Enabled' }],
  ['an empty action', { action: '' }],
  ['an action that is SQL', { action: "repository.enabled' or '1'='1" }],
  ['two actions', { action: ['repository.enabled', 'repository.disabled'] }],
  ['an actor id of zero', { actorGithubId: '0' }],
  ['a negative actor id', { actorGithubId: '-1' }],
  ['an actor id with a fraction', { actorGithubId: '1.5' }],
  ['an actor id in exponent form', { actorGithubId: '1e3' }],
  ['an actor id with a leading zero', { actorGithubId: '012' }],
  ['an actor id with a plus sign', { actorGithubId: '+12' }],
  ['an actor id that is a login', { actorGithubId: 'octocat' }],
  ['an actor id past the safe integers', { actorGithubId: '9007199254740993' }],
  ['an actor id of fifty digits', { actorGithubId: '9'.repeat(50) }],
  ['a subject id of zero', { subjectId: '0' }],
  ['a subject id that is text', { subjectId: 'five' }],
  ['an empty subject id', { subjectId: '' }],
  ['a subject type in the wrong case', { subjectType: 'Repository' }],
  ['a subject type with a space', { subjectType: 'repository id' }],
  ['a subject type with a quote', { subjectType: "repository'" }],
  ['an empty subject type', { subjectType: '' }],
  ['a subject type of 65 characters', { subjectType: `a${'b'.repeat(64)}` }],
  ['from with no offset', { from: '2026-11-01T00:00:00' }],
  ['from as a date only', { from: '2026-11-01' }],
  ['from with an offset written without a colon', { from: '2026-11-01T00:00:00+0200' }],
  ['from with a space for the T', { from: '2026-11-01 00:00:00Z' }],
  ['from with a day the month does not have', { from: '2026-02-30T00:00:00Z' }],
  ['from as epoch seconds', { from: '1793000000' }],
  ['from with sub-millisecond digits', { from: '2026-11-01T00:00:00.1234Z' }],
  ['to with no offset', { to: '2026-11-01T00:00:00' }],
  ['to that is text', { to: 'yesterday' }],
  ['to that is empty', { to: '' }],
  ['a limit of zero', { limit: '0' }],
  ['a limit of 201', { limit: '201' }],
  ['a negative limit', { limit: '-1' }],
  ['a limit with a fraction', { limit: '10.5' }],
  ['a limit that is text', { limit: 'all' }],
  ['an empty limit', { limit: '' }],
  ['a limit with a leading zero', { limit: '050' }],
  ['a cursor that is not ours', { cursor: 'AAAA' }],
  ['an empty cursor', { cursor: '' }],
  ['two cursors', { cursor: [encodeAuditCursor({ occurredAt: '2026-11-02T10:00:00.123456Z', id: 9 })] }],
  ['a parameter nobody defined', { subject_id: '5' }],
  ['the installation id of another tenant', { installationId: '2' }],
  ['a misspelt filter', { actorGithubID: '5' }],
])('%s is refused', (_name, query) => {
  expect(parse(query).success).toBe(false);
});

test.each([
  ['1', 1],
  ['50', 50],
  ['199', 199],
  ['200', 200],
])('a limit of %s is a page of %i rows', (limit, expected) => {
  expect(parse({ limit }).data?.limit).toBe(expected);
});

test.each([
  ['Z', '2026-11-01T12:00:00.000Z'],
  ['+02:00', '2026-11-01T10:00:00.000Z'],
  ['-05:30', '2026-11-01T17:30:00.000Z'],
])('an instant written with the offset %s is the same instant in UTC', (offset, expected) => {
  expect(parse({ from: `2026-11-01T12:00:00${offset}` }).data?.from?.toISOString()).toBe(expected);
});

test('an instant is accepted to the millisecond, and one with fewer decimals too', () => {
  expect(parse({ from: '2026-11-01T12:00:00.123Z' }).data?.from?.toISOString()).toBe('2026-11-01T12:00:00.123Z');
  expect(parse({ from: '2026-11-01T12:00:00.5Z' }).data?.from?.toISOString()).toBe('2026-11-01T12:00:00.500Z');
});
