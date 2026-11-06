// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../../../src/server/adapters/db/schema.ts';
import { REPOSITORIES, TENANT } from './ids.ts';
import { at, insertRow } from './insert.ts';
import { EVALUATIONS } from './pending-data.ts';
import { ALICE } from './people.ts';
import { rowIdOf } from './people-rows.ts';

// E18-S12: what waits for a signature in the seeded tenant: three evaluated pull requests and a commit override.

export async function seedPending(db: Kysely<Database>): Promise<void> {
  const alice = await rowIdOf(db, ALICE);
  for (const evaluation of EVALUATIONS) {
    await insertRow(db, 'pr_evaluations', {
      id: evaluation.id,
      installation_id: TENANT.id,
      repository_id: REPOSITORIES.widgets.id,
      pr_number: evaluation.pr,
      head_sha: evaluation.sha,
      result: 'failure',
      pr_state: evaluation.state,
      details: evaluation.details,
      check_run_id: 880_000 + evaluation.pr,
      created_at: at(evaluation.when),
      updated_at: at(evaluation.when),
    });
  }
  await insertRow(db, 'commit_overrides', {
    id: 9601,
    installation_id: TENANT.id,
    repository_id: REPOSITORIES.widgets.id,
    commit_sha: 'b'.repeat(40),
    created_by: alice,
    reason: 'A commit made by a bot account that the maintainers cannot ask to sign.',
    created_at: at('2026-03-20T15:00:00Z'),
  });
}
