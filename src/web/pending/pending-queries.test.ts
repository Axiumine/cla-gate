// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { testClient } from '../api/test-support.ts';
import {
  overridesKey,
  overridesQueryOptions,
  PENDING_PAGE_SIZE,
  pendingKey,
  pendingQueryOptions,
} from './pending-queries.ts';

// E18-S08: the queries of the screen. Every key starts with the installation, so one tenant's pages are kept and dropped together.

const NONE = { repository: undefined, reason: undefined, cursor: undefined } as const;

test('a page holds 50 rows', () => {
  expect(PENDING_PAGE_SIZE).toBe(50);
});

test("the keys of an installation's lists are under the installation, then 'pending' or 'overrides'", () => {
  expect(pendingKey(5)).toEqual(['installation', 5, 'pending']);
  expect(pendingKey(6)).toEqual(['installation', 6, 'pending']);
  expect(overridesKey(5)).toEqual(['installation', 5, 'overrides']);
});

test('a page of the pending list sits in the cache under the installation, the filters and its cursor, the first page under null', () => {
  const { client } = testClient();
  expect(pendingQueryOptions(client, 5, NONE).queryKey).toEqual(['installation', 5, 'pending', null, null, null]);
  expect(pendingQueryOptions(client, 5, { repository: 7, reason: 'unlinked_identity', cursor: 'c2' }).queryKey).toEqual(
    ['installation', 5, 'pending', 7, 'unlinked_identity', 'c2'],
  );
});

test('the same filters on two installations are two entries, each under its own installation', () => {
  const { client } = testClient();
  const a = pendingQueryOptions(client, 5, NONE);
  const b = pendingQueryOptions(client, 6, NONE);
  expect(a.queryKey).not.toEqual(b.queryKey);
  expect(a.queryKey.slice(0, 3)).toEqual(pendingKey(5));
  expect(b.queryKey.slice(0, 3)).toEqual(pendingKey(6));
});

test('a page of the overrides sits in the cache under the installation, the repository and the cursor', () => {
  const { client } = testClient();
  expect(overridesQueryOptions(client, 5, 7, undefined).queryKey).toEqual(['installation', 5, 'overrides', 7, null]);
  expect(overridesQueryOptions(client, 5, 7, 'c2').queryKey).toEqual(['installation', 5, 'overrides', 7, 'c2']);
  expect(overridesQueryOptions(client, 6, 7, undefined).queryKey).not.toEqual(
    overridesQueryOptions(client, 5, 7, undefined).queryKey,
  );
});

test.each([
  ['the pending list', (client: ReturnType<typeof testClient>['client']) => pendingQueryOptions(client, 5, NONE)],
  [
    'the overrides',
    (client: ReturnType<typeof testClient>['client']) => overridesQueryOptions(client, 5, 7, undefined),
  ],
])(
  '%s is asked for on every visit and when the window gets focus, and the page on screen stays until the next one is there',
  (_what, options) => {
    const { client } = testClient();
    const query = options(client);
    expect(query.staleTime).toBe(0);
    expect(query.refetchOnWindowFocus).toBe(true);
    expect(typeof query.placeholderData).toBe('function');
  },
);
