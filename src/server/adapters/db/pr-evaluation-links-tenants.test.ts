// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { expect, test } from 'vitest';
import {
  EvaluationRowMissingError,
  findCommentIdForPr,
  findRowsForSha,
  hasNewerHeadRow,
  recordCheckRunId,
  recordCommentId,
} from './pr-evaluation-links.ts';
import { linksWorld, readAllEvaluations, scopeOf, sha, WRITERS } from './pr-evaluation-links-fixture/test-support.ts';
import { tenantChecksums, twoTenants } from './tenant-fixture/test-support.ts';
import { asRuntimeRole, containing, migratedRuntimeDatabase } from './test-support.ts';

// E09-S04, the mandatory cross-tenant tests: both tenants of `twoTenants` hold pull request 7 at the head SHA `b` (and 9 at `e`
// and `f`), so a statement that forgot the installation would find the other tenant's row under the very same key. The
// generated matrix of E11-S06 (`tenant-queries-matrix.test.ts`) calls every function once more for both tenants.

test.each(WRITERS)(
  '%s: tenant 1 records on its own row of pull request 7 at `b` and the row of tenant 2 under the same key stays as it was',
  async (_name, record, _column, read) => {
    const { db, t1, t2 } = await linksWorld();
    const before = await readAllEvaluations(db);
    await record(db, scopeOf(t1), { repositoryId: t1.repositoryId, prNumber: 7, headSha: sha('b') }, 4242);
    const changed = (await readAllEvaluations(db)).filter((row) => !before.some((was) => isDeepStrictEqual(was, row)));
    expect(changed.map((row) => [row.installation_id, row.pr_number, row.head_sha, read(row)])).toEqual([
      [t1.installationId, 7, sha('b'), 4242],
    ]);
    expect(changed.map((row) => row.installation_id)).not.toContain(t2.installationId);
  },
);

test.each(WRITERS)(
  '%s: tenant 1 naming the repository of tenant 2 finds no row, throws EvaluationRowMissingError and changes nothing',
  async (_name, record) => {
    const { db, t1, t2 } = await linksWorld();
    const before = await tenantChecksums(db);
    await expect(
      record(db, scopeOf(t1), { repositoryId: t2.repositoryId, prNumber: 7, headSha: sha('b') }, 4242),
    ).rejects.toThrow(EvaluationRowMissingError);
    expect(await tenantChecksums(db)).toEqual(before);
  },
);

test('the reads of tenant 1 over the repository of tenant 2 find no comment, no rows and no newer head', async () => {
  const { db, t1, t2 } = await linksWorld();
  const scope = scopeOf(t1);
  expect(await findCommentIdForPr(db, scope, t2.repositoryId, 9)).toBeNull();
  expect(await findRowsForSha(db, scope, t2.repositoryId, sha('e'))).toEqual([]);
  const key = { repositoryId: t2.repositoryId, prNumber: 9, headSha: sha('e') };
  // Tenant 2 does have a newer head for that key: only its own scope sees it.
  expect(await hasNewerHeadRow(db, scope, key)).toBe(false);
  expect(await hasNewerHeadRow(db, scopeOf(t2), key)).toBe(true);
});

test('each tenant sees its own ids for the pull request number and head SHA they share, and the other tenant never sees them', async () => {
  const { db, t1, t2 } = await linksWorld();
  const key = (repositoryId: number) => ({ repositoryId, prNumber: 7, headSha: sha('b') });
  await recordCheckRunId(db, scopeOf(t1), key(t1.repositoryId), 111);
  await recordCommentId(db, scopeOf(t1), key(t1.repositoryId), 112);
  await recordCheckRunId(db, scopeOf(t2), key(t2.repositoryId), 221);
  await recordCommentId(db, scopeOf(t2), key(t2.repositoryId), 222);
  expect(await findCommentIdForPr(db, scopeOf(t1), t1.repositoryId, 7)).toBe(112);
  expect(await findCommentIdForPr(db, scopeOf(t2), t2.repositoryId, 7)).toBe(222);
  expect(await findRowsForSha(db, scopeOf(t1), t1.repositoryId, sha('b'))).toEqual([
    { prNumber: 7, result: 'success', checkRunId: 111, details: {}, superseded: false },
  ]);
  expect(await findRowsForSha(db, scopeOf(t2), t2.repositoryId, sha('b'))).toEqual([
    { prNumber: 7, result: 'success', checkRunId: 221, details: {}, superseded: false },
  ]);
  expect(await findCommentIdForPr(db, scopeOf(t1), t2.repositoryId, 7)).toBeNull();
});

test('the composite foreign key (repository_id, installation_id) makes a row of one tenant over the repository of another unwritable', async () => {
  const { db, t1, t2 } = await linksWorld();
  const mismatched = db.insertInto('pr_evaluations').values({
    installation_id: t1.installationId,
    repository_id: t2.repositoryId,
    pr_number: 7,
    head_sha: sha('1'),
    result: 'success',
  });
  await expect(mismatched.execute()).rejects.toMatchObject({
    code: '23503',
    message: containing('pr_evaluations_repository_id_installation_id_fkey'),
  });
});

test('cla_app can run every statement of the module, and cannot delete a row, which nothing in it tries', async () => {
  const { db } = await migratedRuntimeDatabase();
  const { t1 } = await twoTenants(db);
  const scope = scopeOf(t1);
  const key = { repositoryId: t1.repositoryId, prNumber: 9, headSha: sha('e') };
  const seen = await asRuntimeRole(db, async (trx) => {
    // Asked first: recording on the older row touches it, which makes it the newest of the pull request.
    const newer = await hasNewerHeadRow(trx, scope, key);
    await recordCheckRunId(trx, scope, key, 555);
    await recordCommentId(trx, scope, key, 556);
    return {
      comment: await findCommentIdForPr(trx, scope, t1.repositoryId, 9),
      rows: await findRowsForSha(trx, scope, t1.repositoryId, sha('e')),
      newer,
    };
  });
  expect(seen).toEqual({
    comment: 556,
    rows: [
      { prNumber: 9, result: 'success', checkRunId: 555, details: {}, superseded: false },
      { prNumber: 10, result: 'success', checkRunId: null, details: {}, superseded: false },
    ],
    newer: true,
  });
  const before = await readAllEvaluations(db);
  await expect(
    asRuntimeRole(db, (trx) =>
      trx
        .deleteFrom('pr_evaluations')
        .where('id', '=', before[0]?.id ?? 0)
        .execute(),
    ),
  ).rejects.toMatchObject({ message: containing('permission denied') });
  expect(await readAllEvaluations(db)).toEqual(before);
});

test('the module has no statement that deletes or truncates', () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test: a literal URL beside this file, the module under test
  const source = fs.readFileSync(new URL('./pr-evaluation-links.ts', import.meta.url), 'utf8');
  expect(source).not.toMatch(/deleteFrom|truncate|delete\s+from/i);
});
