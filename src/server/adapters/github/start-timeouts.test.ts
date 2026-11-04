// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, onTestFinished, test, vi } from 'vitest';
import { testGitHubKey } from '../../config/test-support.ts';
import { id, installation } from '../../services/github-contract/test-support.ts';
import { httpWorld } from './http-world/test-support.ts';
import { CLIENT_TIMEOUT_MS } from './start.ts';

// How long the App waits for GitHub (E07-S10, E14-S05): the self-check and the token requests keep their 10 s, and a call of
// the client, among them the membership lookup of the evaluation and the members probe of the allowlist form, gives up on an
// attempt after 5 s.

/** A started App with the installation 11, and the timeouts its requests have set: those of the start-up, and those since. */
async function watchedApp() {
  const timeouts = vi.spyOn(AbortSignal, 'timeout');
  onTestFinished(() => {
    timeouts.mockRestore();
  });
  const world = await httpWorld(testGitHubKey());
  world.addInstallation(installation(11, 'acme'));
  const afterStart = timeouts.mock.calls.length;
  const all = (): number[] => timeouts.mock.calls.map(([milliseconds]) => milliseconds);
  return {
    client: world.client,
    atStart: () => all().slice(0, afterStart),
    since: () => all().slice(afterStart),
  };
}

test('the self-check and the token request wait 10 s, and the membership lookup waits 5 s for each attempt', async () => {
  const { client, atStart, since } = await watchedApp();
  await client.getOrgMembership(id(11), 'acme', 'alice');
  expect(atStart()).toEqual([10_000]);
  expect(since()).toEqual([10_000, 5000]);
  expect(CLIENT_TIMEOUT_MS).toBe(5000);
});

test('the members probe waits 5 s for each of its two requests, after the 10 s of the token request', async () => {
  const { client, since } = await watchedApp();
  await client.probeMembersPermission(id(11));
  expect(since()).toEqual([10_000, 5000, 5000]);
});
