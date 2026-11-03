// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { seedSignature } from '../../adapters/db/test-support.ts';
import { toStoredDetails } from '../../domain/evaluation/index.ts';
import { commit, commitSha } from '../github-pull-contract/test-support.ts';
import { evaluateWorld, FULL_NAME, INSTALLATION, PR_NUMBER, reported } from './test-support.ts';

// The job composed with the real engine of E08 (E07-S04): the facts it reads are the ones the verdict is made of, and what is
// stored is what the engine said, in the shape of the stored details.

const PEOPLE = [7, 1, 2];

test('a pull request whose people have not signed fails, and the verdict is stored and reported as the engine gave it', async () => {
  const world = await evaluateWorld({ engine: true });
  expect(await world.run()).toEqual({ outcome: 'evaluated' });
  const verdict = reported(world);
  expect(verdict.outcome).toBe('failure');
  expect(verdict.failureCodes).toContain('unsigned_contributor');
  const [row] = await world.rows();
  expect(row?.result).toBe('failure');
  expect(row?.details).toEqual(toStoredDetails(verdict));
});

test('a pull request whose people all hold a signature of the active version passes', async () => {
  const world = await evaluateWorld({ engine: true });
  for (const person of PEOPLE) {
    await seedSignature(world.raw, world.tenant, person);
  }
  await world.run();
  const verdict = reported(world);
  expect(verdict).toMatchObject({ outcome: 'success', failureCodes: [] });
  const [row] = await world.rows();
  expect(row?.result).toBe('success');
  expect(row?.details).toEqual(toStoredDetails(verdict));
});

test('a signature that was revoked is no signature', async () => {
  const world = await evaluateWorld({ engine: true });
  for (const person of PEOPLE) {
    await seedSignature(world.raw, world.tenant, person);
  }
  await world.raw
    .updateTable('signatures')
    .set({ revoked_at: sql`now()`, revoked_by: world.tenant.publisherId })
    .execute();
  await world.run();
  expect(world.reporter.published.at(0)?.evaluation.outcome).toBe('failure');
});

test('a repository without a CLA fails with no_active_cla, and no signature is read', async () => {
  const world = await evaluateWorld({ engine: true, cla: false });
  await world.run();
  expect(world.reporter.published.at(0)?.evaluation.failureCodes).toEqual(['no_active_cla']);
  expect(world.timeline).not.toContain('db:select signatures');
  expect((await world.rows()).map((row) => row.result)).toEqual(['failure']);
});

test('a signature made on the last read is counted: a person who signs while the job waits for GitHub is covered', async () => {
  const world = await evaluateWorld({ engine: true });
  for (const person of [7, 1]) {
    await seedSignature(world.raw, world.tenant, person);
  }
  world.reporter.hooks.started = async () => {
    await seedSignature(world.raw, world.tenant, 2);
  };
  await world.run();
  expect(world.reporter.published.at(0)?.evaluation.outcome).toBe('success');
});

test('the reporter is given the logins the job saw and the names of the unresolved co-author trailers of the commits (E09-S03)', async () => {
  const world = await evaluateWorld({ engine: true });
  world.fake.setPullRequestCommits(INSTALLATION, FULL_NAME, PR_NUMBER, [
    commit(1),
    commit(2, { message: 'Subject\n\nBody.\n\nCo-authored-by: Jane Roe <jane@example.org>' }),
  ]);
  await world.run();
  const names = world.reporter.published.at(0)?.names;
  expect([...(names?.logins ?? [])]).toEqual([
    [7, 'user-7'],
    [1, 'user-1'],
    [2, 'user-2'],
  ]);
  expect([...(names?.coAuthors ?? [])]).toEqual([[commitSha(2), ['Jane Roe']]]);
});
