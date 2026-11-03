// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import {
  EvaluationRowMissingError,
  findCommentIdForPr,
  findRowsForSha,
  hasNewerHeadRow,
  type LinkKey,
  recordCommentId,
} from './pr-evaluation-links.ts';
import {
  insertEvaluation,
  linksWorld,
  readAllEvaluations,
  recording,
  scopeOf,
  sha,
  WRITERS,
} from './pr-evaluation-links-fixture/test-support.ts';

// E09-S04: the two reporting columns of `pr_evaluations` and the reads the reporter needs. `twoTenants` stores for each tenant
// pull request 9 at two head SHAs (`e` holds a Check Run (n * 10000 + 1) and a comment (n * 10000 + 2), `f` was touched a day
// later and holds a Check Run only) and pull request 10 at `e`, next to pull request 7 at `b` and 8 at `c` (see
// `tenant-fixture/test-support.ts`).

const JANUARY = new Date('2026-01-01T00:00:00Z');
const FEBRUARY = new Date('2026-02-01T00:00:00Z');
const MARCH = new Date('2026-03-01T00:00:00Z');

/** What the fixture stores with a row that a test gives no details. */
const STORED = { code: 'evaluation_failed' };
/** An id above 2^31, as the Check Run ids of GitHub are. */
const BIG = 9_876_543_210;

test.each(WRITERS)(
  '%s sets its column and updated_at on the row of the key and changes no other column and no other row',
  async (_name, record, column) => {
    const { db, t1 } = await linksWorld();
    const target = await insertEvaluation(db, t1, {
      prNumber: 20,
      headSha: sha('1'),
      result: 'failure',
      checkRunId: 71,
      commentId: 72,
      updatedAt: JANUARY,
    });
    await insertEvaluation(db, t1, { prNumber: 20, headSha: sha('2'), checkRunId: 73, updatedAt: JANUARY });
    await insertEvaluation(db, t1, { prNumber: 21, headSha: sha('1'), commentId: 74, updatedAt: JANUARY });
    const before = await readAllEvaluations(db);
    await record(db, scopeOf(t1), { repositoryId: t1.repositoryId, prNumber: 20, headSha: sha('1') }, BIG);
    const after = await readAllEvaluations(db);
    const written = after.find((row) => row.id === target);
    // Every column of the row but the id it was given and the time is what it was; the details and the result are the job's.
    expect(written).toEqual({
      ...before.find((row) => row.id === target),
      [column]: BIG,
      updated_at: written?.updated_at,
    });
    expect(written?.updated_at.getTime()).toBeGreaterThan(JANUARY.getTime());
    expect(after.filter((row) => row.id !== target)).toEqual(before.filter((row) => row.id !== target));
  },
);

test.each(WRITERS)(
  '%s is one update that names the tenant, the repository, the pull request and the head SHA',
  async (_name, record, column) => {
    const { db, t1 } = await linksWorld();
    const { db: traced, sent } = recording(db);
    await record(traced, scopeOf(t1), { repositoryId: t1.repositoryId, prNumber: 9, headSha: sha('e') }, 55);
    expect(sent).toEqual([
      {
        sql: `update "pr_evaluations" set "${column}" = $1, "updated_at" = now() where "installation_id" = $2 and "repository_id" = $3 and "pr_number" = $4 and "head_sha" = $5 returning "id"`,
        parameters: [55, t1.installationId, t1.repositoryId, 9, sha('e')],
      },
    ]);
  },
);

test.each(WRITERS)(
  '%s is repeatable: the same id again leaves the same value',
  async (_name, record, _column, read) => {
    const { db, t1 } = await linksWorld();
    const key = { repositoryId: t1.repositoryId, prNumber: 9, headSha: sha('e') };
    await record(db, scopeOf(t1), key, BIG);
    await record(db, scopeOf(t1), key, BIG);
    const row = (await readAllEvaluations(db)).find(
      (stored) =>
        stored.pr_number === 9 && stored.head_sha === sha('e') && stored.installation_id === t1.installationId,
    );
    expect(row === undefined ? undefined : read(row)).toBe(BIG);
  },
);

/** Keys that name no row of tenant 1, each differing from pull request 9 at `e` of its plain repository in one part. */
const MISSING: readonly (readonly [string, (repositoryId: number, scopedId: number) => LinkKey])[] = [
  ['another head SHA', (repositoryId) => ({ repositoryId, prNumber: 9, headSha: sha('0') })],
  ['another pull request', (repositoryId) => ({ repositoryId, prNumber: 99, headSha: sha('e') })],
  [
    'another repository of the tenant',
    (_repositoryId, scopedId) => ({ repositoryId: scopedId, prNumber: 9, headSha: sha('e') }),
  ],
];

test.each(WRITERS.flatMap(([name, record]) => MISSING.map(([variant, key]) => [name, record, variant, key] as const)))(
  '%s throws EvaluationRowMissingError for %s that has no row, and writes nothing',
  async (_name, record, _variant, key) => {
    const { db, t1 } = await linksWorld();
    const before = await readAllEvaluations(db);
    await expect(record(db, scopeOf(t1), key(t1.repositoryId, t1.scoped.repositoryId), 5)).rejects.toThrow(
      EvaluationRowMissingError,
    );
    expect(await readAllEvaluations(db)).toEqual(before);
  },
);

test('EvaluationRowMissingError is an Error that names the defect and no one', () => {
  const error = new EvaluationRowMissingError();
  expect(error).toBeInstanceOf(Error);
  expect([error.name, error.message]).toEqual([
    'EvaluationRowMissingError',
    'no evaluation row for this pull request and head SHA',
  ]);
});

test('ids go through the int8 parser: one above 2^31 comes back exact, one a number cannot hold is refused', async () => {
  const { db, t1 } = await linksWorld();
  const scope = scopeOf(t1);
  await recordCommentId(db, scope, { repositoryId: t1.repositoryId, prNumber: 9, headSha: sha('f') }, BIG);
  expect(await findCommentIdForPr(db, scope, t1.repositoryId, 9)).toBe(BIG);
  await sql`update pr_evaluations set comment_id = 1152921504606846976 where pr_number = 9 and head_sha = ${sha('f')} and installation_id = ${t1.installationId}`.execute(
    db,
  );
  await expect(findCommentIdForPr(db, scope, t1.repositoryId, 9)).rejects.toThrow(RangeError);
});

test('findCommentIdForPr: the comment of the older head SHA, when the newer one has none, and the other tenant has its own', async () => {
  const { db, t1, t2 } = await linksWorld();
  expect(await findCommentIdForPr(db, scopeOf(t1), t1.repositoryId, 9)).toBe(10_002);
  expect(await findCommentIdForPr(db, scopeOf(t2), t2.repositoryId, 9)).toBe(20_002);
});

test.each([
  ['the row touched last, not the one with the larger id', 20, 111],
  ['the larger id when two rows were touched at once', 21, 222],
  ['null when no row of the pull request has one', 22, null],
  ['null for a pull request nobody evaluated', 99, null],
])('findCommentIdForPr returns %s', async (_name, prNumber, expected) => {
  const { db, t1 } = await linksWorld();
  await insertEvaluation(db, t1, { prNumber: 20, headSha: sha('1'), commentId: 111, updatedAt: FEBRUARY });
  await insertEvaluation(db, t1, { prNumber: 20, headSha: sha('2'), commentId: 222, updatedAt: JANUARY });
  await insertEvaluation(db, t1, { prNumber: 21, headSha: sha('1'), commentId: 111, updatedAt: JANUARY });
  await insertEvaluation(db, t1, { prNumber: 21, headSha: sha('2'), commentId: 222, updatedAt: JANUARY });
  await insertEvaluation(db, t1, { prNumber: 22, headSha: sha('1'), checkRunId: 5, updatedAt: JANUARY });
  expect(await findCommentIdForPr(db, scopeOf(t1), t1.repositoryId, prNumber)).toBe(expected);
});

test('findCommentIdForPr: a comment on the same pull request number of another repository of the tenant is not this one', async () => {
  const { db, t1 } = await linksWorld();
  await insertEvaluation(
    db,
    { installationId: t1.installationId, repositoryId: t1.scoped.repositoryId },
    { prNumber: 30, headSha: sha('1'), commentId: 333 },
  );
  expect(await findCommentIdForPr(db, scopeOf(t1), t1.repositoryId, 30)).toBeNull();
  expect(await findCommentIdForPr(db, scopeOf(t1), t1.scoped.repositoryId, 30)).toBe(333);
});

test('findRowsForSha: one entry per pull request evaluated at the head SHA, with its result and Check Run id, by number', async () => {
  const { db, t1 } = await linksWorld();
  expect(await findRowsForSha(db, scopeOf(t1), t1.repositoryId, sha('e'))).toEqual([
    { prNumber: 9, result: 'success', checkRunId: 10_001, details: {}, superseded: true },
    { prNumber: 10, result: 'success', checkRunId: null, details: {}, superseded: false },
  ]);
  await insertEvaluation(db, t1, { prNumber: 30, headSha: sha('3'), result: 'in_progress', checkRunId: 5 });
  await insertEvaluation(db, t1, { prNumber: 4, headSha: sha('3'), result: 'failure' });
  await insertEvaluation(db, t1, { prNumber: 5, headSha: sha('3'), result: 'cancelled', checkRunId: 6 });
  await insertEvaluation(db, t1, { prNumber: 6, headSha: sha('4'), result: 'failure' });
  await insertEvaluation(
    db,
    { installationId: t1.installationId, repositoryId: t1.scoped.repositoryId },
    { prNumber: 7, headSha: sha('3') },
  );
  expect(await findRowsForSha(db, scopeOf(t1), t1.repositoryId, sha('3'))).toEqual([
    { prNumber: 4, result: 'failure', checkRunId: null, details: STORED, superseded: false },
    { prNumber: 5, result: 'cancelled', checkRunId: 6, details: STORED, superseded: false },
    { prNumber: 30, result: 'in_progress', checkRunId: 5, details: STORED, superseded: false },
  ]);
});

test('findRowsForSha: the rows come by number whatever order the plan reads them in, not by the order they were stored', async () => {
  const { db, t1 } = await linksWorld();
  for (const prNumber of [30, 4, 12]) {
    await insertEvaluation(db, t1, { prNumber, headSha: sha('3') });
  }
  // The unique index happens to deliver the rows by number, which would hide a missing ORDER BY: read the table in storage order.
  const rows = await db.transaction().execute(async (trx) => {
    await sql`set local enable_indexscan = off`.execute(trx);
    await sql`set local enable_bitmapscan = off`.execute(trx);
    await sql`set local enable_indexonlyscan = off`.execute(trx);
    return findRowsForSha(trx, scopeOf(t1), t1.repositoryId, sha('3'));
  });
  expect(rows.map((row) => row.prNumber)).toEqual([4, 12, 30]);
});

test('findRowsForSha: the details the job stored come with each row', async () => {
  const { db, t1 } = await linksWorld();
  const details = { version: 1, outcome: 'success', actors: [] };
  await insertEvaluation(db, t1, { prNumber: 30, headSha: sha('3'), details });
  const [row] = await findRowsForSha(db, scopeOf(t1), t1.repositoryId, sha('3'));
  expect(row?.details).toEqual(details);
});

test.each([
  ['the older row of a pull request that has a row touched later at another head SHA', 23, '1', true],
  ['not the newest row of the pull request, whatever its id', 23, '2', false],
  ['not a pull request with a single head SHA', 25, '1', false],
  ['not a row touched at the same time as the other row of its pull request', 24, '1', false],
])('findRowsForSha marks %s as superseded: %s', async (_name, prNumber, digit, expected) => {
  const { db, t1 } = await linksWorld();
  await insertEvaluation(db, t1, { prNumber: 23, headSha: sha('1'), updatedAt: JANUARY });
  await insertEvaluation(db, t1, { prNumber: 23, headSha: sha('2'), updatedAt: FEBRUARY });
  await insertEvaluation(db, t1, { prNumber: 24, headSha: sha('1'), updatedAt: MARCH });
  await insertEvaluation(db, t1, { prNumber: 24, headSha: sha('2'), updatedAt: MARCH });
  await insertEvaluation(db, t1, { prNumber: 25, headSha: sha('1'), updatedAt: JANUARY });
  const rows = await findRowsForSha(db, scopeOf(t1), t1.repositoryId, sha(digit));
  expect(rows.find((row) => row.prNumber === prNumber)?.superseded).toBe(expected);
});

test('findRowsForSha: a row of the same pull request number in another repository of the tenant does not supersede', async () => {
  const { db, t1 } = await linksWorld();
  await insertEvaluation(db, t1, { prNumber: 31, headSha: sha('1'), updatedAt: JANUARY });
  await insertEvaluation(
    db,
    { installationId: t1.installationId, repositoryId: t1.scoped.repositoryId },
    { prNumber: 31, headSha: sha('2'), updatedAt: MARCH },
  );
  const [row] = await findRowsForSha(db, scopeOf(t1), t1.repositoryId, sha('1'));
  expect(row?.superseded).toBe(false);
});

test('findRowsForSha: a row of the same pull request number in another tenant does not supersede', async () => {
  const { db, t1, t2 } = await linksWorld();
  await insertEvaluation(db, t1, { prNumber: 32, headSha: sha('1'), updatedAt: JANUARY });
  await insertEvaluation(db, t2, { prNumber: 32, headSha: sha('2'), updatedAt: MARCH });
  const [row] = await findRowsForSha(db, scopeOf(t1), t1.repositoryId, sha('1'));
  expect(row?.superseded).toBe(false);
});

test('findRowsForSha: a head SHA nobody evaluated has no rows', async () => {
  const { db, t1 } = await linksWorld();
  expect(await findRowsForSha(db, scopeOf(t1), t1.repositoryId, sha('9'))).toEqual([]);
});

test.each([
  ['the older row, when the row of another head SHA was touched later', 9, 'e', true],
  ['not the newest row of the pull request', 9, 'f', false],
  ['not a pull request with one head SHA', 10, 'e', false],
  ['not a pull request that another, touched later, was evaluated beside', 7, 'b', false],
  ['not a row that does not exist', 99, 'e', false],
  ['the row touched first, not the row with the smaller id', 23, '1', true],
  ['not the row touched last, whatever its id', 23, '2', false],
  ['not a row touched at the same time as the other', 24, '1', false],
  ['not the other row touched at the same time', 24, '2', false],
])('hasNewerHeadRow is true for %s, false otherwise', async (_name, prNumber, digit, expected) => {
  const { db, t1 } = await linksWorld();
  await insertEvaluation(db, t1, { prNumber: 23, headSha: sha('1'), updatedAt: JANUARY });
  await insertEvaluation(db, t1, { prNumber: 23, headSha: sha('2'), updatedAt: FEBRUARY });
  await insertEvaluation(db, t1, { prNumber: 24, headSha: sha('1'), updatedAt: MARCH });
  await insertEvaluation(db, t1, { prNumber: 24, headSha: sha('2'), updatedAt: MARCH });
  const key = { repositoryId: t1.repositoryId, prNumber, headSha: sha(digit) };
  expect(await hasNewerHeadRow(db, scopeOf(t1), key)).toBe(expected);
});

test('hasNewerHeadRow: a row of the same pull request number in another repository of the tenant is not a newer head', async () => {
  const { db, t1 } = await linksWorld();
  await insertEvaluation(db, t1, { prNumber: 31, headSha: sha('1'), updatedAt: JANUARY });
  await insertEvaluation(
    db,
    { installationId: t1.installationId, repositoryId: t1.scoped.repositoryId },
    { prNumber: 31, headSha: sha('2'), updatedAt: MARCH },
  );
  expect(
    await hasNewerHeadRow(db, scopeOf(t1), { repositoryId: t1.repositoryId, prNumber: 31, headSha: sha('1') }),
  ).toBe(false);
});

test('hasNewerHeadRow is one read and writes nothing', async () => {
  const { db, t1 } = await linksWorld();
  const before = await readAllEvaluations(db);
  const { db: traced, sent } = recording(db);
  await hasNewerHeadRow(traced, scopeOf(t1), { repositoryId: t1.repositoryId, prNumber: 9, headSha: sha('e') });
  expect(sent.map((statement) => statement.sql.split(' ', 1)[0])).toEqual(['select']);
  expect(await readAllEvaluations(db)).toEqual(before);
});
