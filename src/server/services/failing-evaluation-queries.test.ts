// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { twoTenants } from '../adapters/db/tenant-fixture/test-support.ts';
import { migratedTestDatabase } from '../adapters/db/test-support.ts';
import { failureDetails, successDetails } from '../domain/failure-details-fixture/test-support.ts';
import { findFailingEvaluations } from './failing-evaluation-queries.ts';
import { attachDocument, headOf, storeFailure } from './sign-evaluations-fixture/test-support.ts';

// The statement behind the signer's other failing pull requests (E13-S07): the latest evaluation of each pull request of the
// repositories attached to the signed document, kept when it failed and lists the person as uncovered; newest first; the
// pull request the person came from left out; and nothing of another tenant, whatever document or person is asked for.

/** Tenant 1 and 2 on a fresh database; the plain repository of each enforces the tenant's document. */
async function world() {
  const { db } = await migratedTestDatabase();
  const tenants = await twoTenants(db);
  await attachDocument(db, tenants.t1, ['plain']);
  await attachDocument(db, tenants.t2, ['plain']);
  const { t1 } = tenants;
  const ada = t1.signer.githubId;
  const at = (day: number) => new Date(Date.UTC(2026, 5, day));
  const repository = { installationId: t1.installationId, repositoryId: t1.plain.repositoryId };
  const lookup = (overrides: Partial<Parameters<typeof findFailingEvaluations>[2]> = {}) =>
    findFailingEvaluations(
      db,
      { installationId: t1.installationId },
      {
        documentId: t1.documentId,
        githubId: ada,
        origin: null,
        limit: 100,
        ...overrides,
      },
    );
  /** The pull requests the lookup answers, as `<GitHub repository id>#<number>`. */
  const found = async (overrides?: Parameters<typeof lookup>[0]) =>
    (await lookup(overrides)).map((row) => `${row.githubRepoId}#${row.prNumber}`);
  return { db, ...tenants, ada, at, repository, lookup, found };
}

test('a pull request whose latest evaluation failed and lists the person as uncovered is answered with its stored details', async () => {
  const { db, t1, ada, at, repository, lookup } = await world();
  const details = failureDetails({ uncovered: [ada, 77], covered: [88], documentId: t1.documentId });
  await storeFailure(db, repository, { prNumber: 61, details, updatedAt: at(1) });
  expect(await lookup()).toEqual([{ githubRepoId: t1.plain.githubRepoId, prNumber: 61, details }]);
});

test('the pull requests come newest first by the time their row was touched, and the id breaks a tie', async () => {
  const { db, t1, ada, at, repository, found } = await world();
  const details = failureDetails({ uncovered: [ada] });
  await storeFailure(db, repository, { prNumber: 61, details, updatedAt: at(2) });
  await storeFailure(db, repository, { prNumber: 62, details, updatedAt: at(4) });
  await storeFailure(db, repository, { prNumber: 63, details, updatedAt: at(3) });
  await storeFailure(db, repository, { prNumber: 64, details, updatedAt: at(3) });
  const repo = t1.plain.githubRepoId;
  expect(await found()).toEqual([`${repo}#62`, `${repo}#64`, `${repo}#63`, `${repo}#61`]);
});

test('a pull request appears once, with its latest row, however many head SHAs failed', async () => {
  const { db, t1, ada, at, repository, found } = await world();
  const details = failureDetails({ uncovered: [ada] });
  await storeFailure(db, repository, { prNumber: 61, headSha: headOf('1'), details, updatedAt: at(1) });
  await storeFailure(db, repository, { prNumber: 61, headSha: headOf('2'), details, updatedAt: at(2) });
  await storeFailure(db, repository, { prNumber: 61, headSha: headOf('3'), details, updatedAt: at(3) });
  expect(await found()).toEqual([`${t1.plain.githubRepoId}#61`]);
});

test.each([
  ['passed', 'success'],
  ['is evaluated again', 'in_progress'],
  ['was cancelled', 'cancelled'],
] as const)(
  'a pull request whose newest row %s is not answered, though an older head SHA of it failed for the person',
  async (_name, result) => {
    const { db, ada, at, repository, found } = await world();
    const failing = failureDetails({ uncovered: [ada] });
    await storeFailure(db, repository, { prNumber: 61, headSha: headOf('1'), details: failing, updatedAt: at(1) });
    await storeFailure(db, repository, {
      prNumber: 61,
      headSha: headOf('2'),
      result,
      details: successDetails([ada]),
      updatedAt: at(2),
    });
    expect(await found()).toEqual([]);
  },
);

test('a row of an older head SHA that was touched last is the latest: a pull request moved back to a head that fails is answered', async () => {
  const { db, t1, ada, at, repository, found } = await world();
  const failing = failureDetails({ uncovered: [ada] });
  await storeFailure(db, repository, { prNumber: 61, headSha: headOf('1'), details: failing, updatedAt: at(5) });
  await storeFailure(db, repository, {
    prNumber: 61,
    headSha: headOf('2'),
    result: 'success',
    details: successDetails([ada]),
    updatedAt: at(2),
  });
  expect(await found()).toEqual([`${t1.plain.githubRepoId}#61`]);
});

test.each([
  ['another person uncovered', (ada: number) => failureDetails({ uncovered: [ada + 1] })],
  ['the person covered and another uncovered', (ada: number) => failureDetails({ uncovered: [7], covered: [ada] })],
  ['nobody listed', () => failureDetails({ uncovered: [] })],
  ['details of an evaluation that has not finished', () => ({})],
])('a failure that lists %s does not name the person and is not answered by the statement', async (_name, details) => {
  const { db, ada, at, repository, found } = await world();
  await storeFailure(db, repository, { prNumber: 61, details: details(ada), updatedAt: at(1) });
  expect(await found()).toEqual([]);
});

test('a pull request that is closed is not answered, though its latest row failed for the person: the state of the latest row decides, and an older row says nothing (E15-S01)', async () => {
  const { db, t1, ada, at, repository, found } = await world();
  const details = failureDetails({ uncovered: [ada] });
  const closed = await storeFailure(db, repository, { prNumber: 61, details, updatedAt: at(1) });
  await storeFailure(db, repository, { prNumber: 62, headSha: headOf('1'), details, updatedAt: at(1) });
  const olderClosed = await storeFailure(db, repository, {
    prNumber: 62,
    headSha: headOf('2'),
    details,
    updatedAt: at(2),
  });
  await storeFailure(db, repository, { prNumber: 63, headSha: headOf('1'), details, updatedAt: at(1) });
  const latestClosed = await storeFailure(db, repository, {
    prNumber: 63,
    headSha: headOf('2'),
    details,
    updatedAt: at(2),
  });
  await db
    .updateTable('pr_evaluations')
    .set({ pr_state: 'closed' })
    .where('id', 'in', [closed, olderClosed, latestClosed])
    .execute();
  await db
    .updateTable('pr_evaluations')
    .set({ pr_state: 'open' })
    .where('repository_id', '=', t1.plain.repositoryId)
    .where('pr_number', '=', 62)
    .where('head_sha', '=', headOf('2'))
    .execute();
  expect(await found()).toEqual([`${t1.plain.githubRepoId}#62`]);
  await db.updateTable('pr_evaluations').set({ pr_state: 'open' }).where('id', '=', closed).execute();
  expect(await found()).toEqual([`${t1.plain.githubRepoId}#62`, `${t1.plain.githubRepoId}#61`]);
});

test('only the repositories attached to the signed document are looked at: another document, none, and a removed repository are not', async () => {
  const { db, t1, ada, at, repository, found } = await world();
  const details = failureDetails({ uncovered: [ada] });
  await storeFailure(db, repository, { prNumber: 61, details, updatedAt: at(1) });
  const scoped = { installationId: t1.installationId, repositoryId: t1.scoped.repositoryId };
  await storeFailure(db, scoped, { prNumber: 62, details, updatedAt: at(2) });
  expect(await found()).toEqual([`${t1.plain.githubRepoId}#61`]);
  await attachDocument(db, t1, ['scoped']);
  expect(await found()).toEqual([`${t1.scoped.githubRepoId}#62`, `${t1.plain.githubRepoId}#61`]);
  await db
    .updateTable('repositories')
    .set({ removed_at: at(3) })
    .where('id', '=', t1.scoped.repositoryId)
    .execute();
  expect(await found()).toEqual([`${t1.plain.githubRepoId}#61`]);
  await db.updateTable('repositories').set({ cla_document_id: null }).where('id', '=', t1.plain.repositoryId).execute();
  expect(await found()).toEqual([]);
});

test('a repository that is not enabled is looked at like any other: enforcement is not required, as for the sign page', async () => {
  const { db, t1, ada, at, repository, found } = await world();
  await db.updateTable('repositories').set({ enabled: false }).where('id', '=', t1.plain.repositoryId).execute();
  await storeFailure(db, repository, { prNumber: 61, details: failureDetails({ uncovered: [ada] }), updatedAt: at(1) });
  expect(await found()).toEqual([`${t1.plain.githubRepoId}#61`]);
});

test('the pull request the person came from is left out, and the same number in another repository is not', async () => {
  const { db, t1, ada, at, repository, found } = await world();
  const details = failureDetails({ uncovered: [ada] });
  const scoped = { installationId: t1.installationId, repositoryId: t1.scoped.repositoryId };
  await attachDocument(db, t1, ['scoped']);
  await storeFailure(db, repository, { prNumber: 61, details, updatedAt: at(1) });
  await storeFailure(db, repository, { prNumber: 62, details, updatedAt: at(2) });
  await storeFailure(db, scoped, { prNumber: 61, details, updatedAt: at(3) });
  const origin = { repositoryId: t1.plain.repositoryId, prNumber: 61 };
  expect(await found({ origin })).toEqual([`${t1.scoped.githubRepoId}#61`, `${t1.plain.githubRepoId}#62`]);
  expect(await found({ origin: null })).toHaveLength(3);
});

test('the limit counts the rows after the pull request of the origin is left out, so it does not use one up', async () => {
  const { db, t1, ada, at, repository, found } = await world();
  const details = failureDetails({ uncovered: [ada] });
  for (const prNumber of [61, 62, 63]) {
    await storeFailure(db, repository, { prNumber, details, updatedAt: at(prNumber - 50) });
  }
  const origin = { repositoryId: t1.plain.repositoryId, prNumber: 63 };
  expect(await found({ origin, limit: 2 })).toEqual([`${t1.plain.githubRepoId}#62`, `${t1.plain.githubRepoId}#61`]);
});

test("another tenant's evaluations are not read: not for its document, and not for the same numeric id listed in its failures", async () => {
  const { db, t1, t2, ada, at, repository, lookup, found } = await world();
  const details = failureDetails({ uncovered: [ada] });
  await storeFailure(db, repository, { prNumber: 61, details, updatedAt: at(1) });
  await storeFailure(
    db,
    { installationId: t2.installationId, repositoryId: t2.plain.repositoryId },
    { prNumber: 70, details, updatedAt: at(9) },
  );
  expect(await found()).toEqual([`${t1.plain.githubRepoId}#61`]);
  expect(await lookup({ documentId: t2.documentId })).toEqual([]);
  expect(await lookup({ githubId: t2.signer.githubId })).toEqual([]);
});
