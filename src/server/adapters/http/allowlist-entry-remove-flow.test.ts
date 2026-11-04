// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { removeEntryAs, storeEntries } from './allowlist-list-fixture/test-support.ts';
import { enableAs } from './repository-enable-fixture/test-support.ts';
import { COVERED, flowWorld, UNCOVERED } from './repository-flow-fixture/test-support.ts';

// Taking an exemption away, from the click to the Check Runs (E14-S07), with GitHub stubbed by MSW behind the real Octokit adapter and
// the jobs run in-process in the order the queue would: the real engine, the real reporter. The person who opened the uncovered pull
// request is exempt, so the repository is green; removing the entry turns the check red, with no new push and no GitHub question
// asked by the removal itself.

test('removing the entry that exempted the author turns the green check of the open pull request red, and the covered one stays green', async () => {
  const world = await flowWorld();
  const { t1, people } = world;
  const [entryId] = await storeEntries(world, [
    {
      installationId: t1.installationId,
      repositoryId: null,
      kind: 'user',
      githubId: people.outsider.githubId,
      loginSnapshot: 'outsider-login',
      createdBy: people.admin1.userId,
    },
  ]);
  await enableAs(world, 'admin1', t1.plain.repositoryId);
  await world.drain();
  expect([await world.conclusionOf(COVERED), await world.conclusionOf(UNCOVERED)]).toEqual(['success', 'success']);
  const asked = world.github.requests.length;
  const response = await removeEntryAs(world, 'admin1', t1.installationId, String(entryId));
  expect([response.statusCode, response.body]).toEqual([204, '']);
  expect(world.github.requests).toHaveLength(asked);
  await world.drain();
  expect([await world.conclusionOf(COVERED), await world.conclusionOf(UNCOVERED)]).toEqual(['success', 'failure']);
  const removed = await removeEntryAs(world, 'admin1', t1.installationId, String(entryId));
  expect(removed.statusCode).toBe(404);
});
