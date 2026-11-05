// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { PENDING_REASON_CODES, type PendingReasonCode } from '../../../shared/pending-prs.ts';
import { type DetailsSpec, shaOf } from '../../domain/pending-details-fixture/test-support.ts';
import { plainOf, scopedOf } from './commit-override-fixture/test-support.ts';
import {
  errorCodeOf,
  namesOf,
  type PendingWorld,
  pageOf,
  pendingWorld,
  storeEvaluations,
  withoutRequestId,
} from './pending-prs-fixture/test-support.ts';

// The filters of `GET …/pending-prs` (E15-S07): `reason` keeps the pull requests that have a reason with that code, `repositoryId` the
// pull requests of one repository. The reason is answered by the database from the codes the engine stored, and the answer must be the
// one the pure function gives for the same details: the corpus below holds one pull request for each shape.

/** The pull requests of the corpus, by number: what the engine or the dead-letter write stored for them. */
const CORPUS: readonly (readonly [number, DetailsSpec | object])[] = [
  [1, { codes: ['no_active_cla'], actors: [{ githubId: 90 }] }],
  [2, { codes: ['unsigned_contributor'], actors: [{ githubId: 91 }] }],
  [3, { codes: ['bot_not_allowlisted'], actors: [{ githubId: 92, bot: true }] }],
  [
    4,
    { codes: ['unsigned_contributor', 'bot_not_allowlisted'], actors: [{ githubId: 93 }, { githubId: 94, bot: true }] },
  ],
  [5, { codes: ['unlinked_identity'], unlinked: [{ sha: shaOf(1) }] }],
  [6, { codes: ['commit_limit_exceeded'] }],
  [
    7,
    {
      codes: ['unsigned_contributor', 'unlinked_identity', 'commit_limit_exceeded'],
      actors: [{ githubId: 95 }],
      unlinked: [{ sha: shaOf(2) }],
    },
  ],
  [8, { code: 'evaluation_failed' }],
  [9, {}],
  [10, { code: 'unknown' }],
  [11, { codes: [] }],
];

/** The world with the corpus stored in the plain repository of tenant 1, one row each, the lower numbers written earlier. */
async function corpusWorld(): Promise<PendingWorld> {
  const world = await pendingWorld();
  await storeEvaluations(
    world,
    plainOf(world.t1),
    CORPUS.map(([number, details]) => ({
      prNumber: FIRST_NUMBER + number,
      details,
      updatedAt: `2026-10-01T10:00:${String(number).padStart(2, '0')}Z`,
    })),
  );
  return world;
}

/** The number of a pull request of the corpus is its number in the repository less this: the world stores the pull requests 7 to 10 itself. */
const FIRST_NUMBER = 100;

/** The pull requests of an answer as the corpus numbers them, in the order of the page. */
const numbersOf = (response: Parameters<typeof pageOf>[0]): number[] =>
  pageOf(response).items.map((item) => item.prNumber - FIRST_NUMBER);

test('every pull request of the corpus is listed with at least one reason, and the ones with no recognised reason with other', async () => {
  const { pending, t1 } = await corpusWorld();
  const { items } = pageOf(await pending('admin1', t1.installationId, '?limit=100'));
  expect(items.map((item) => item.prNumber - FIRST_NUMBER)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  expect(items.map((item) => item.reasons.length > 0)).toEqual(items.map(() => true));
  const other = items.filter((item) => item.reasons.some((reason) => reason.code === 'other'));
  expect(other.map((item) => item.prNumber - FIRST_NUMBER)).toEqual([11, 10, 9, 8]);
});

test.each(PENDING_REASON_CODES)(
  'reason=%s keeps exactly the pull requests that list a reason of that code, as the pure function says',
  async (code: PendingReasonCode) => {
    const { pending, t1 } = await corpusWorld();
    const everything = pageOf(await pending('admin1', t1.installationId, '?limit=100')).items;
    const expected = everything
      .filter((item) => item.reasons.some((reason) => reason.code === code))
      .map((item) => item.prNumber - FIRST_NUMBER);
    expect(expected.length).toBeGreaterThan(0);
    expect(numbersOf(await pending('admin1', t1.installationId, `?limit=100&reason=${code}`))).toEqual(expected);
  },
);

test('the reason filter names the pull requests the corpus was built for', async () => {
  const { pending, t1 } = await corpusWorld();
  const forReason = async (code: PendingReasonCode) =>
    numbersOf(await pending('admin1', t1.installationId, `?limit=100&reason=${code}`));
  expect(await forReason('no_active_cla')).toEqual([1]);
  expect(await forReason('unsigned_contributor')).toEqual([7, 4, 2]);
  expect(await forReason('bot_not_allowlisted')).toEqual([4, 3]);
  expect(await forReason('unlinked_identity')).toEqual([7, 5]);
  expect(await forReason('commit_limit_exceeded')).toEqual([7, 6]);
  expect(await forReason('other')).toEqual([11, 10, 9, 8]);
});

test('the reason filter pages without a gap: a filtered page ends where the next one starts', async () => {
  const { pending, t1 } = await corpusWorld();
  const first = pageOf(await pending('admin1', t1.installationId, '?limit=2&reason=unsigned_contributor'));
  expect(first.items.map((item) => item.prNumber - FIRST_NUMBER)).toEqual([7, 4]);
  const second = pageOf(
    await pending('admin1', t1.installationId, `?limit=2&reason=unsigned_contributor&cursor=${first.nextCursor}`),
  );
  expect(second.items.map((item) => item.prNumber - FIRST_NUMBER)).toEqual([2]);
  expect(second.nextCursor).toBeNull();
});

test('a reason filter matches the latest evaluation only: an older failure of the reason does not keep a pull request in the answer', async () => {
  const world = await pendingWorld();
  await storeEvaluations(world, plainOf(world.t1), [
    {
      prNumber: FIRST_NUMBER + 5,
      head: 1,
      details: { codes: ['commit_limit_exceeded'] },
      updatedAt: '2026-10-01T10:00:00Z',
    },
    { prNumber: FIRST_NUMBER + 5, head: 2, details: { codes: ['no_active_cla'] }, updatedAt: '2026-10-02T10:00:00Z' },
  ]);
  expect(numbersOf(await world.pending('admin1', world.t1.installationId, '?reason=commit_limit_exceeded'))).toEqual(
    [],
  );
  expect(numbersOf(await world.pending('admin1', world.t1.installationId, '?reason=no_active_cla'))).toEqual([5]);
});

test('repositoryId keeps the pull requests of that repository, and nothing of the others', async () => {
  const world = await pendingWorld();
  const { pending, t1 } = world;
  await storeEvaluations(world, plainOf(t1), [{ prNumber: 5 }]);
  await storeEvaluations(world, scopedOf(t1), [{ prNumber: 5 }, { prNumber: 6, updatedAt: '2030-01-01T00:00:00Z' }]);
  expect(namesOf(await pending('admin1', t1.installationId, `?repositoryId=${t1.plain.repositoryId}`))).toEqual([
    'org-1/repo#5',
  ]);
  expect(namesOf(await pending('admin1', t1.installationId, `?repositoryId=${t1.scoped.repositoryId}`))).toEqual([
    'org-1/scoped#6',
    'org-1/scoped#5',
  ]);
});

test('repositoryId and reason together keep the pull requests that satisfy both', async () => {
  const world = await pendingWorld();
  const { pending, t1 } = world;
  await storeEvaluations(world, plainOf(t1), [{ prNumber: 5, details: { codes: ['no_active_cla'] } }, { prNumber: 6 }]);
  await storeEvaluations(world, scopedOf(t1), [{ prNumber: 7, details: { codes: ['no_active_cla'] } }]);
  const query = `?repositoryId=${t1.plain.repositoryId}&reason=no_active_cla`;
  expect(namesOf(await pending('admin1', t1.installationId, query))).toEqual(['org-1/repo#5']);
});

test('a repository of another tenant is the 404 of an id that exists nowhere, byte for byte, and the same in the other direction', async () => {
  const world = await pendingWorld();
  const { pending, t1, t2 } = world;
  await storeEvaluations(world, plainOf(t2), [{ prNumber: 5 }]);
  const unknown = await pending('admin1', t1.installationId, '?repositoryId=987654');
  for (const repositoryId of [t2.plain.repositoryId, t2.scoped.repositoryId]) {
    const crossed = await pending('admin1', t1.installationId, `?repositoryId=${repositoryId}`);
    expect([crossed.statusCode, errorCodeOf(crossed)]).toEqual([404, 'not_found']);
    expect(withoutRequestId(crossed)).toBe(withoutRequestId(unknown));
    expect(crossed.body).not.toContain('org-2');
  }
  expect([unknown.statusCode, errorCodeOf(unknown)]).toEqual([404, 'not_found']);
  expect((await pending('admin2', t2.installationId, `?repositoryId=${t1.plain.repositoryId}`)).statusCode).toBe(404);
  expect(namesOf(await pending('admin2', t2.installationId, `?repositoryId=${t2.plain.repositoryId}`))).toEqual([
    'org-2/repo#5',
  ]);
});

test('a repository of the installation that is switched off or has left is an empty page, not a 404', async () => {
  const world = await pendingWorld();
  const { db, pending, t1 } = world;
  await storeEvaluations(world, plainOf(t1), [{ prNumber: 5 }]);
  await db.updateTable('repositories').set({ enabled: false }).where('id', '=', t1.plain.repositoryId).execute();
  expect(pageOf(await pending('admin1', t1.installationId, `?repositoryId=${t1.plain.repositoryId}`)).items).toEqual(
    [],
  );
  await db
    .updateTable('repositories')
    .set({ enabled: true, removed_at: new Date('2026-10-01T00:00:00Z') })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  expect(pageOf(await pending('admin1', t1.installationId, `?repositoryId=${t1.plain.repositoryId}`)).items).toEqual(
    [],
  );
});
