// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { QueryClient } from '@tanstack/react-query';
import { expect, test } from 'vitest';
import { ApiError } from '../api/errors.ts';
import { envelope, json, testClient } from '../api/test-support.ts';
import { OPERATOR_KEY, operatorQueryOptions } from './operator-queries.ts';
import { installationOf, operatorList, rejectedOf, serveOperator } from './test-support.ts';

// E18-S13: the query of the operator screen: the key is the person's, a 200 is the operator with the installations, a 404 is data (not the
// operator) and not an error, and every other failure is still a failure.

const { client } = testClient();
const ask = () => new QueryClient().query({ ...operatorQueryOptions(client), retry: false });

test('the key is the person\'s and not a tenant\'s: it does not start with ["installation", id]', () => {
  expect(OPERATOR_KEY).toEqual(['operator', 'installations']);
  expect(operatorQueryOptions(client).queryKey).toEqual(OPERATOR_KEY);
});

test('a 200 is the operator, with the installations as the endpoint sent them', async () => {
  const seen = serveOperator(operatorList([installationOf(), rejectedOf()]));
  expect(await ask()).toEqual({ operator: true, installations: [installationOf(), rejectedOf()] });
  expect(seen.map(({ method }) => method)).toEqual(['GET']);
  expect(new URL(String(seen[0]?.url)).pathname).toBe('/api/operator/installations');
});

test('a 200 with no installation is still the operator', async () => {
  serveOperator(operatorList([]));
  expect(await ask()).toEqual({ operator: true, installations: [] });
});

test('a 404 is the answer "not the operator", not a failure', async () => {
  serveOperator(envelope(404, 'not_found'));
  expect(await ask()).toEqual({ operator: false });
});

test.each([
  [401, 'unauthorized'],
  [403, 'forbidden'],
  [502, 'github_unavailable'],
  [500, 'internal_error'],
])('a %s is a failure and never "not the operator"', async (status, code) => {
  serveOperator(envelope(status, code));
  const failure: unknown = await ask().catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(ApiError);
  expect(failure).toMatchObject({ status });
});

test('an answer that is not the contract is a failure too', async () => {
  serveOperator(json({ installations: [{ accountLogin: 'acme' }] }));
  const failure: unknown = await ask().catch((error: unknown) => error);
  expect(failure).toMatchObject({ name: 'ContractError' });
});
