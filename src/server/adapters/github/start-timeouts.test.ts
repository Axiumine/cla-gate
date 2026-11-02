// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, onTestFinished, test, vi } from 'vitest';
import { testGitHubKey } from '../../config/test-support.ts';
import { id, installation } from '../../services/github-contract/test-support.ts';
import { httpWorld } from './http-world/test-support.ts';
import { CLIENT_TIMEOUT_MS } from './start.ts';

// How long the App waits for GitHub (E07-S10): the self-check and the token requests keep their 10 s, and a call of the
// client, among them the membership lookup of the evaluation, gives up on an attempt after 5 s.

test('the self-check and the token request wait 10 s, and the membership lookup waits 5 s for each attempt', async () => {
  const timeouts = vi.spyOn(AbortSignal, 'timeout');
  onTestFinished(() => {
    timeouts.mockRestore();
  });
  const world = await httpWorld(testGitHubKey());
  world.addInstallation(installation(11, 'acme'));
  const afterStart = timeouts.mock.calls.length;
  await world.client.getOrgMembership(id(11), 'acme', 'alice');
  expect(timeouts.mock.calls.slice(0, afterStart).map(([milliseconds]) => milliseconds)).toEqual([10_000]);
  expect(timeouts.mock.calls.slice(afterStart).map(([milliseconds]) => milliseconds)).toEqual([10_000, 5000]);
  expect(CLIENT_TIMEOUT_MS).toBe(5000);
});
