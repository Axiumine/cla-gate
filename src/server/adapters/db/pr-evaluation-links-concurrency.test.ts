// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { expect, test } from 'vitest';
import { storedDetailsSample } from '../../../shared/test-support.ts';
import { finishEvaluation } from '../../services/evaluate-pr/evaluation-rows.ts';
import { recordCheckRunId, recordCommentId } from './pr-evaluation-links.ts';
import { linksWorld, readAllEvaluations, scopeOf, sha } from './pr-evaluation-links-fixture/test-support.ts';
import type { Database } from './schema.ts';
import { realPostgresOnly, withConnections } from './test-support.ts';

// E09-S04: the reporting columns under real concurrency. PGlite has one session, so these run in the CI `postgres` job only
// (`realPostgresOnly`); the statements they race are covered on PGlite by `pr-evaluation-links.test.ts`. The calls start
// together at a barrier, never after a timer. The row is pull request 10 at `e` of tenant 1, which has no Check Run and no
// comment (see `tenant-fixture/test-support.ts`).

const CHECK_RUN_IDS = Array.from({ length: 20 }, (_unused, index) => 7_000_000_001 + index);
const COMMENT_ID = 7_100_000_001;

/** The rows of pull request 10 at `e` of the tenant: the fixture stores one, and a second would be a statement that inserted. */
async function rowsOf10(db: Kysely<Database>, installationId: number) {
  return (await readAllEvaluations(db)).filter(
    (row) => row.pr_number === 10 && row.head_sha === sha('e') && row.installation_id === installationId,
  );
}

async function row10(db: Kysely<Database>, installationId: number) {
  const [only, ...others] = await rowsOf10(db, installationId);
  expect(others).toEqual([]);
  return only ?? expect.fail('the fixture stores pull request 10 for the tenant');
}

test('the row the races below use has no Check Run and no comment before they start', async () => {
  const { db, t1 } = await linksWorld();
  const row = await row10(db, t1.installationId);
  expect([row.check_run_id, row.comment_id, row.result]).toEqual([null, null, 'success']);
});

realPostgresOnly(
  '20 parallel recordCheckRunId calls for one key leave one of their values and never revert it to null',
  async () => {
    const { db, t1 } = await linksWorld();
    const connections = withConnections(CHECK_RUN_IDS.length);
    const key = { repositoryId: t1.repositoryId, prNumber: 10, headSha: sha('e') };
    const seenByEach = await Promise.all(
      CHECK_RUN_IDS.map(async (id, index) => {
        await connections.barrier();
        await recordCheckRunId(connections.get(index), scopeOf(t1), key, id);
        // Once a call has returned, its commit is visible: a later call cannot take the value back.
        return (await row10(connections.get(index), t1.installationId)).check_run_id;
      }),
    );
    expect(seenByEach.every((seen) => seen !== null && CHECK_RUN_IDS.includes(seen))).toBe(true);
    expect(CHECK_RUN_IDS).toContain((await row10(db, t1.installationId)).check_run_id);
  },
);

realPostgresOnly(
  'the 20 calls, a comment id and a concurrent result update each leave their own column as written',
  async () => {
    const { db, t1 } = await linksWorld();
    const connections = withConnections(CHECK_RUN_IDS.length + 2);
    const scope = scopeOf(t1);
    const key = { repositoryId: t1.repositoryId, prNumber: 10, headSha: sha('e') };
    const verdict = storedDetailsSample();
    const target = await row10(db, t1.installationId);
    const recorders = CHECK_RUN_IDS.map(async (id, index) => {
      await connections.barrier();
      await recordCheckRunId(connections.get(index), scope, key, id);
    });
    const commenter = (async () => {
      await connections.barrier();
      await recordCommentId(connections.get(CHECK_RUN_IDS.length), scope, key, COMMENT_ID);
    })();
    const finisher = (async () => {
      await connections.barrier();
      await finishEvaluation(connections.get(CHECK_RUN_IDS.length + 1), t1.installationId, target.id, verdict);
    })();
    await Promise.all([...recorders, commenter, finisher]);
    const stored = await row10(db, t1.installationId);
    expect(CHECK_RUN_IDS).toContain(stored.check_run_id);
    expect({ comment: stored.comment_id, result: stored.result, details: stored.details }).toEqual({
      comment: COMMENT_ID,
      result: verdict.outcome,
      details: verdict,
    });
  },
);
