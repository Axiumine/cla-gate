// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Expression, type SqlBool, sql } from 'kysely';
import { expect, test } from 'vitest';
import { failureDetails } from '../domain/failure-details-fixture/test-support.ts';
import { findAffectedPrs, findAffectedRepositories } from './affected-prs-queries.ts';
import { coveredBy, revocationWorld, storePr } from './revocation-fixture/test-support.ts';

// The statements behind the pull requests an action re-evaluates (E15-S03): the open pull requests whose latest evaluation has the
// result asked for and, when a condition on the details is given, answers it. The newest row of a pull request decides, never an
// older head SHA, and nothing of another tenant is read. Tenant 1's repositories are `org-1/repo` (GitHub id 9000) and `org-1/scoped` (9001).

const SIGNER = 4711;
const SIGNATURE = 31;

/** A world with the pull requests below stored in tenant 1, and one pull request of tenant 2 that matches as well. */
async function world() {
  const base = await revocationWorld();
  const { db, t1, t2 } = base;
  const covered = coveredBy({ githubId: SIGNER, signatureId: SIGNATURE });
  const other = coveredBy({ githubId: SIGNER + 1, signatureId: SIGNATURE + 1 });
  await storePr(db, t1, 'plain', { prNumber: 61, details: covered });
  await storePr(db, t1, 'plain', { prNumber: 62, details: covered, state: 'closed' });
  await storePr(db, t1, 'plain', { prNumber: 63, head: '1', day: 1, details: covered });
  await storePr(db, t1, 'plain', { prNumber: 63, head: '2', day: 2, details: other });
  await storePr(db, t1, 'plain', { prNumber: 64, head: '1', day: 1, result: 'failure', details: covered });
  await storePr(db, t1, 'plain', { prNumber: 64, head: '2', day: 2, details: covered });
  await storePr(db, t1, 'plain', { prNumber: 65, result: 'in_progress', details: covered });
  await storePr(db, t1, 'plain', { prNumber: 66, result: 'cancelled', details: covered });
  await storePr(db, t1, 'plain', { prNumber: 67, result: 'failure', details: failureDetails({ uncovered: [SIGNER] }) });
  await storePr(db, t1, 'scoped', { prNumber: 61, details: covered });
  await storePr(db, t2, 'plain', { prNumber: 61, details: covered });
  const scope = { installationId: t1.installationId };
  const repositories = [t1.plain.repositoryId, t1.scoped.repositoryId];
  return { ...base, scope, repositories };
}

/** The condition of a revocation: the stored details contain an actor with the signer's id, covered by a signature. */
const namesSigner = (details: Expression<unknown>): Expression<SqlBool> =>
  sql<boolean>`${details} @> ${JSON.stringify({ actors: [{ githubId: SIGNER, covered: true }] })}::jsonb`;

/** The pull requests as `<GitHub repository id>#<number>`, without the ones the world seeds (7, 9 and 10, finished successes with no actors; 8, running). */
const asText = (rows: readonly { githubRepoId: number; prNumber: number }[]) =>
  rows.filter((row) => row.prNumber >= 61).map((row) => `${row.githubRepoId}#${row.prNumber}`);

test('the open pull requests whose latest success names the signer are found in the order of repository and number, with the ids a job names', async () => {
  const { db, scope, repositories, t1 } = await world();
  const found = await findAffectedPrs(db, scope, repositories, {
    result: 'success',
    detailsMatch: namesSigner,
    limit: 10,
  });
  expect(asText(found)).toEqual(['9000#61', '9000#64', '9001#61']);
  expect(found[0]).toEqual({
    repositoryId: t1.plain.repositoryId,
    githubInstallationId: t1.githubInstallationId,
    githubRepoId: t1.plain.githubRepoId,
    prNumber: 61,
  });
});

test('only the latest row of a pull request counts: an older head that matched is ignored, and a newer one that matches is found', async () => {
  const { db, scope, repositories } = await world();
  const found = asText(
    await findAffectedPrs(db, scope, repositories, { result: 'success', detailsMatch: namesSigner, limit: 10 }),
  );
  expect(found).not.toContain('9000#63');
  expect(found).toContain('9000#64');
});

test('a closed pull request, one in progress and one cancelled are not found, with or without a condition', async () => {
  const { db, scope, repositories } = await world();
  const withCondition = asText(
    await findAffectedPrs(db, scope, repositories, { result: 'success', detailsMatch: namesSigner, limit: 10 }),
  );
  const without = asText(await findAffectedPrs(db, scope, repositories, { result: 'success', limit: 10 }));
  for (const found of [withCondition, without]) {
    expect(found).not.toContain('9000#62');
    expect(found).not.toContain('9000#65');
    expect(found).not.toContain('9000#66');
  }
});

test('with no condition on the details every open pull request whose latest result is the one asked for is found, and the result decides', async () => {
  const { db, scope, repositories } = await world();
  expect(asText(await findAffectedPrs(db, scope, repositories, { result: 'success', limit: 10 }))).toEqual([
    '9000#61',
    '9000#63',
    '9000#64',
    '9001#61',
  ]);
  expect(asText(await findAffectedPrs(db, scope, repositories, { result: 'failure', limit: 10 }))).toEqual(['9000#67']);
});

test('no more than the limit is found, the first ones in the order', async () => {
  const { db, scope, repositories } = await world();
  const found = await findAffectedPrs(db, scope, repositories, { result: 'success', limit: 5 });
  expect(found).toHaveLength(5);
  expect(asText(found)).toEqual(['9000#61', '9000#63']);
});

test('only the repositories asked for are looked at, and none asked for finds nothing', async () => {
  const { db, scope, t1 } = await world();
  const scoped = [t1.scoped.repositoryId];
  expect(asText(await findAffectedPrs(db, scope, scoped, { result: 'success', limit: 10 }))).toEqual(['9001#61']);
  expect(await findAffectedPrs(db, scope, [], { result: 'success', limit: 10 })).toEqual([]);
});

test('the pull requests of another tenant are never found, whatever repository ids are given, and a repository id of another tenant finds nothing', async () => {
  const { db, scope, repositories, t2 } = await world();
  const both = [...repositories, t2.plain.repositoryId, t2.scoped.repositoryId];
  expect(asText(await findAffectedPrs(db, scope, both, { result: 'success', limit: 10 }))).toEqual([
    '9000#61',
    '9000#63',
    '9000#64',
    '9001#61',
  ]);
  const foreign = [t2.plain.repositoryId, t2.scoped.repositoryId];
  expect(await findAffectedPrs(db, scope, foreign, { result: 'success', limit: 10 })).toEqual([]);
  expect(await findAffectedRepositories(db, scope, foreign, { result: 'success' })).toEqual([]);
});

test('the repositories with such a pull request are listed once each, in the order of their ids, with the ids a job names', async () => {
  const { db, scope, repositories, t1 } = await world();
  const found = await findAffectedRepositories(db, scope, [...repositories].reverse(), {
    result: 'success',
    detailsMatch: namesSigner,
  });
  expect(found).toEqual([
    {
      repositoryId: t1.plain.repositoryId,
      githubInstallationId: t1.githubInstallationId,
      githubRepoId: t1.plain.githubRepoId,
    },
    {
      repositoryId: t1.scoped.repositoryId,
      githubInstallationId: t1.githubInstallationId,
      githubRepoId: t1.scoped.githubRepoId,
    },
  ]);
  const onlyScoped = await findAffectedRepositories(db, scope, repositories, {
    result: 'success',
    detailsMatch: (details) => sql<boolean>`${details} @> ${JSON.stringify({ actors: [{ githubId: 1 }] })}::jsonb`,
  });
  expect(onlyScoped).toEqual([]);
});
