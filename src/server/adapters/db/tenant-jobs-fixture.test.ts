// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { JOB_TENANT_QUERIES } from './tenant-jobs-fixture/test-support.ts';
import { migratedTestDatabase } from './test-support.ts';

// The refusals the registry entries of the job queue's statements name (E07): a repository of another installation is refused by
// the database, and the update of a row of another installation finds none.

const ROWS = JOB_TENANT_QUERIES['services/evaluate-pr/evaluation-rows.ts'];
const START = ROWS?.['startEvaluation']?.refusal;
const FAIL = ROWS?.['failEvaluation']?.refusal;
const FINISH = ROWS?.['finishEvaluation']?.refusal;

test.each([
  ['startEvaluation', START],
  ['failEvaluation', FAIL],
])('%s: the foreign key violation of the database is its refusal, and nothing else is', (_name, refusal) => {
  expect(refusal?.(Object.assign(new Error('violates foreign key'), { code: '23503' }))).toBe(true);
  expect(refusal?.(Object.assign(new Error('duplicate key'), { code: '23505' }))).toBe(false);
  expect(refusal?.(new Error('no code'))).toBe(false);
  expect(refusal?.('23503')).toBe(false);
  expect(refusal?.(null)).toBe(false);
});

test('finishEvaluation: the update that finds no row of the installation is its refusal, and nothing else is', async () => {
  const { db } = await migratedTestDatabase();
  const noRow = await db
    .updateTable('pr_evaluations')
    .set({ result: 'failure' })
    .where('id', '=', 1)
    .returning('id')
    .executeTakeFirstOrThrow()
    .catch((error: unknown) => error);
  expect(FINISH?.(noRow)).toBe(true);
  expect(FINISH?.(new Error('no result'))).toBe(false);
});

test('only the writes that can be turned away name a refusal', () => {
  const named = Object.entries(JOB_TENANT_QUERIES).flatMap(([file, queries]) =>
    Object.entries(queries).flatMap(([name, query]) => (query.refusal === undefined ? [] : [`${file} ${name}`])),
  );
  expect(named).toEqual([
    'services/evaluate-pr/evaluation-rows.ts startEvaluation',
    'services/evaluate-pr/evaluation-rows.ts finishEvaluation',
    'services/evaluate-pr/evaluation-rows.ts failEvaluation',
    'services/merge-group/merge-group-rows.ts startGroupEvaluation',
    'services/merge-group/merge-group-rows.ts failGroupEvaluation',
  ]);
});
