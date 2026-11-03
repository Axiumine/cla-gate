// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import {
  addSecondTenant,
  expectNothingWritten,
  HEAD,
  ORG_1,
  PR_NUMBER,
  REPOSITORY,
  rerunWorld,
  tenantPayload,
} from './rerun-fixture/test-support.ts';

// A re-run across tenants (E09-S08): the payload of a re-run that names installation A and a repository that is stored under B, which
// is what a transfer GitHub has told us about too late looks like, writes nothing for B, at the route and in a job that was already queued.

test.each([['check_run'], ['check_suite']] as const)(
  'a %s re-run naming installation A and a repository stored under B starts nothing for B: the route turns it into a sync of A',
  async (event) => {
    const world = await rerunWorld();
    const a = await addSecondTenant(world);
    const stale = { installation: a.installation, repository: ORG_1.repository };
    const answer = await world.deliver(event, tenantPayload(event, stale, HEAD));
    expect(answer.json()).toEqual({ status: 'ignored', reason: 'repository_installation_mismatch' });
    expect((await world.queued()).map((sent) => sent.job)).toMatchObject([
      { type: 'sync-installation', githubInstallationId: a.installation },
    ]);
    expect(await world.drain()).toEqual(['sync-installation:synced']);
    expect(world.synced).toEqual([a.installation]);
    await expectNothingWritten(world);
  },
);

test('a re-run job queued before the repository moved to B finds no such repository under A and writes nothing for B', async () => {
  const world = await rerunWorld();
  const a = await addSecondTenant(world);
  const githubInstallationId = parseGithubId(a.installation);
  await world.send({ type: 'evaluate-head-sha', githubInstallationId, githubRepoId: REPOSITORY, headSha: HEAD });
  await world.send({
    type: 'evaluate-pr',
    githubInstallationId,
    githubRepoId: REPOSITORY,
    prNumber: PR_NUMBER,
    trigger: 'check_rerequested',
  });
  expect(await world.drain()).toEqual([
    'evaluate-head-sha:skipped:repository_not_found',
    'evaluate-pr:skipped:repository_not_found',
  ]);
  await expectNothingWritten(world);
});
