// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { seedSignature } from '../adapters/db/test-support.ts';
import { evaluateWorld, JOB } from './evaluate-pr/test-support.ts';
import { createJobsTable, fakeEnqueuer, sentJobs } from './jobs-fixture/test-support.ts';
import { revokeSignature } from './signature-revoke.ts';

// A revocation that commits while the pull request is being evaluated (E15-S03): the run has read the signatures already, so it stores a
// success that rests on the signature just revoked, and only another run can correct it. The pull request is found by its row in flight,
// and the job that is sent reads the signatures when it runs.

const SIGNERS = [7, 1, 2];
const REVOKER = parseGithubId(424242);

test('a signature revoked after the evaluation read it sends the pull request to be evaluated again, which then fails it', async () => {
  const world = await evaluateWorld({ engine: true });
  await createJobsTable(world.raw);
  const queue = fakeEnqueuer();
  const signatures: Awaited<ReturnType<typeof seedSignature>>[] = [];
  for (const person of SIGNERS) {
    signatures.push(await seedSignature(world.raw, world.tenant, person));
  }
  expect(await world.run()).toEqual({ outcome: 'evaluated' });
  expect((await world.rows()).map((row) => row.result)).toEqual(['success']);
  const opener = signatures.at(0)?.signatureId ?? 0;
  const revoke = () =>
    revokeSignature(
      { db: world.raw, enqueuer: queue },
      { installationId: world.tenant.installationId },
      { signatureId: opener, reason: 'legal_request', actor: { userId: world.tenant.publisherId, githubId: REVOKER } },
    );
  let reevaluating = -1;
  // The first look at the pull request loads it; the second is the last step of the run, after the signatures were read.
  world.fake.beforeNext('getPullRequest', () => Promise.resolve());
  world.fake.beforeNext('getPullRequest', async () => {
    reevaluating = (await revoke()).reevaluating;
  });
  expect(await world.run({ ...JOB, trigger: 'sweep' })).toEqual({ outcome: 'evaluated' });
  expect((await world.rows()).map((row) => row.result)).toEqual(['success']);
  expect(reevaluating).toBe(1);
  const sent = (await sentJobs(world.raw)).map(({ job }) => job);
  expect(sent).toEqual([{ ...JOB, trigger: 'signature' }]);
  expect(await world.run({ ...JOB, trigger: 'signature' })).toEqual({ outcome: 'evaluated' });
  expect((await world.rows()).map((row) => row.result)).toEqual(['failure']);
});
