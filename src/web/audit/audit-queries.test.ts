// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { testClient } from '../api/test-support.ts';
import { NO_FILTERS } from './audit-filters.ts';
import { AUDIT_PAGE_SIZE, auditKey, auditQueryOptions } from './audit-queries.ts';

// E18-S09: the query of the screen. Its key starts with the installation, so one tenant's pages are kept and dropped together.

test('a page holds 50 events', () => {
  expect(AUDIT_PAGE_SIZE).toBe(50);
});

test("the key of an installation's audit log is under the installation, then 'audit'", () => {
  expect(auditKey(5)).toEqual(['installation', 5, 'audit']);
  expect(auditKey(6)).toEqual(['installation', 6, 'audit']);
});

test('a page sits in the cache under the installation, the filters and its cursor, the first page under null', () => {
  const { client } = testClient();
  const first = auditQueryOptions(client, 5, { filters: NO_FILTERS, cursor: undefined });
  const later = auditQueryOptions(client, 5, {
    filters: {
      action: 'signature.revoked',
      actorGithubId: 4711,
      subjectType: 'signature',
      subjectId: 9,
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-11-02T00:00:00.000Z',
    },
    cursor: 'c2',
  });
  expect(first.queryKey).toEqual(['installation', 5, 'audit', null, null, null, null, null, null, null]);
  expect(later.queryKey).toEqual([
    'installation',
    5,
    'audit',
    'signature.revoked',
    4711,
    'signature',
    9,
    '2026-11-01T00:00:00.000Z',
    '2026-11-02T00:00:00.000Z',
    'c2',
  ]);
});

test('the same filters on two installations are two entries, each under its own installation', () => {
  const { client } = testClient();
  const a = auditQueryOptions(client, 5, { filters: NO_FILTERS, cursor: undefined });
  const b = auditQueryOptions(client, 6, { filters: NO_FILTERS, cursor: undefined });
  expect(a.queryKey).not.toEqual(b.queryKey);
  expect(a.queryKey.slice(0, 3)).toEqual(auditKey(5));
  expect(b.queryKey.slice(0, 3)).toEqual(auditKey(6));
});

test('an actor and a subject of the same number are not the same entry', () => {
  const { client } = testClient();
  const actor = auditQueryOptions(client, 5, { filters: { ...NO_FILTERS, actorGithubId: 9 }, cursor: undefined });
  const subject = auditQueryOptions(client, 5, { filters: { ...NO_FILTERS, subjectId: 9 }, cursor: undefined });
  expect(actor.queryKey).not.toEqual(subject.queryKey);
});

test('the log is asked for on every visit, and the page on screen stays until the next one of the same search is there', () => {
  const { client } = testClient();
  const options = auditQueryOptions(client, 5, { filters: NO_FILTERS, cursor: undefined });
  expect(options.staleTime).toBe(0);
  expect(typeof options.placeholderData).toBe('function');
});
