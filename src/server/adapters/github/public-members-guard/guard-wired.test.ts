// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { test } from 'vitest';
import { testGitHubKey } from '../../../config/test-support.ts';
import { clientFixture } from '../client-fixture/test-support.ts';
import { GITHUB_API_ORIGIN } from '../github-http.ts';
import { httpWorld } from '../http-world/test-support.ts';

// The mocked GitHubs of the adapter tests carry the guard: `test.fails` passes only when the test it holds fails, and the
// only thing these tests do is send a request to an endpoint, so the guard is what fails them when the test ends.

test.fails('the adapter fixture fails the test that reaches a public-members endpoint, whatever the code did with the error', async () => {
  clientFixture({});
  await fetch(`${GITHUB_API_ORIGIN}/orgs/acme/public_members/alice`).catch(() => undefined);
});

test.fails('the mocked GitHub of the contract suite fails the test that reaches a public-members endpoint, whatever the code did with the error', async () => {
  await httpWorld(testGitHubKey());
  await fetch(`${GITHUB_API_ORIGIN}/orgs/acme/public_members`).catch(() => undefined);
});
