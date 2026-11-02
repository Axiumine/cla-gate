// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { testGitHubKey } from '../../../config/test-support.ts';
import { id, installation } from '../../../services/github-contract/test-support.ts';
import { GITHUB_API_ORIGIN } from '../github-http.ts';
import { httpWorld } from './test-support.ts';

// The mocked GitHub of the contract suite has to refuse what the real one refuses, or the suite proves less than it says.

const signer = testGitHubKey();

test.each([
  ['signed by a key the App does not hold', { authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.e30.AAAA' }],
  ['with no credentials at all', {}],
])('a token request %s is refused with a 401', async (_name, headers) => {
  const world = await httpWorld(signer);
  world.addInstallation(installation(11, 'acme'));
  const response = await fetch(`${GITHUB_API_ORIGIN}/app/installations/11/access_tokens`, { method: 'POST', headers });
  expect(response.status).toBe(401);
});

test.each([
  ['no token', undefined],
  ['a token of an installation nobody has', 'Bearer ghs_made-up-999-1'],
  ['something that is not a made-up token', 'Bearer ghs_other'],
])('the installation routes refuse %s with a 401', async (_name, authorization) => {
  const world = await httpWorld(signer);
  world.addInstallation(installation(11, 'acme'));
  const response = await fetch(`${GITHUB_API_ORIGIN}/installation/repositories`, {
    headers: authorization === undefined ? {} : { authorization },
  });
  expect(response.status).toBe(401);
});

test('suspending an installation the world never had is a mistake in the test, and says so', async () => {
  const world = await httpWorld(signer);
  expect(() => {
    world.suspend(id(404), new Date());
  }).toThrow('the world has no installation 404: add it first');
});

test('requests are counted from after the start-up self-check', async () => {
  const world = await httpWorld(signer);
  expect(world.requests).toEqual([]);
  await world.client.getApp();
  expect(world.requests).toEqual(['GET /app']);
});
