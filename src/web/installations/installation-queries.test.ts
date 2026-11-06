// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { testClient } from '../api/test-support.ts';
import {
  INSTALLATIONS_KEY,
  installationKey,
  installationsQueryOptions,
  OVERVIEW_REPOSITORIES,
  overviewQueryOptions,
} from './installation-queries.ts';

// E18-S04: the keys and the requests of the installation queries.

const { client } = testClient();

test('the key of a tenant starts with the word "installation" and the id, and is a different key for each id', () => {
  expect(installationKey(5)).toEqual(['installation', 5]);
  expect(installationKey(5)).not.toEqual(installationKey(6));
});

test('the list of the person is not under a tenant: its key does not start with ["installation", id]', () => {
  expect(INSTALLATIONS_KEY).toEqual(['installations']);
  expect(installationsQueryOptions(client).queryKey).toEqual(INSTALLATIONS_KEY);
});

test('every query of a tenant starts with its key, and names the page it holds', () => {
  const key = overviewQueryOptions(client, 7).queryKey;
  expect(key.slice(0, 2)).toEqual(installationKey(7));
  expect(key).toEqual(['installation', 7, 'repositories', { limit: OVERVIEW_REPOSITORIES }]);
});

test('the overview asks for ten repositories, and the queries use no placeholder data from another key', () => {
  expect(OVERVIEW_REPOSITORIES).toBe(10);
  expect('placeholderData' in overviewQueryOptions(client, 7)).toBe(false);
  expect('placeholderData' in installationsQueryOptions(client)).toBe(false);
});
