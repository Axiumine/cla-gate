// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, expectTypeOf, test } from 'vitest';
import { ALLOWLIST_KINDS, type OUTCOMES } from '../../../shared/pr-evaluation-codes.ts';
import { parseStoredDetails } from '../../../shared/pr-evaluation-details.ts';
import { storedDetailsSample } from '../../../shared/test-support.ts';
import type { AllowlistKind } from '../../domain/evaluation/types.ts';
import type { Database } from './schema.ts';
import { migratedTestDatabase, seedTenant } from './test-support.ts';

// E08-S01: the stored details are written to the jsonb column `pr_evaluations.details` by a later story. This proves the
// vocabulary of the domain agrees with the table and that a value survives the round trip through a real jsonb column.

test('the engine vocabulary matches the columns that store it', () => {
  expectTypeOf<Database['allowlist_entries']['kind']>().toEqualTypeOf<AllowlistKind>();
  expectTypeOf<Exclude<Database['pr_evaluations']['result'], 'in_progress'>>().toEqualTypeOf<
    (typeof OUTCOMES)[number]
  >();
});

test('the database accepts every allowlist kind of the vocabulary and nothing else', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  for (const [index, kind] of ALLOWLIST_KINDS.entries()) {
    await db
      .insertInto('allowlist_entries')
      .values({
        installation_id: tenant.installationId,
        repository_id: null,
        kind,
        github_id: index + 1,
        created_by: tenant.publisherId,
      })
      .execute();
  }
  const unknownKind = sql`insert into allowlist_entries (installation_id, kind, github_id, created_by)
    values (${tenant.installationId}, 'login', 9, ${tenant.publisherId})`;
  await expect(unknownKind.execute(db)).rejects.toMatchObject({ code: '23514' });
});

test('stored details survive a jsonb column and are read back unchanged', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  const sample = storedDetailsSample();
  await db
    .insertInto('pr_evaluations')
    .values({
      installation_id: tenant.installationId,
      repository_id: tenant.repositoryId,
      pr_number: 7,
      head_sha: 'a'.repeat(40),
      result: sample.outcome,
      details: JSON.stringify(sample),
    })
    .execute();
  const row = await db
    .selectFrom('pr_evaluations')
    .select('details')
    .where('pr_number', '=', 7)
    .executeTakeFirstOrThrow();
  expect(parseStoredDetails(row.details)).toEqual({ ok: true, details: sample });
});

test('a row that is still in progress has the default details, which are not an evaluation', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  await db
    .insertInto('pr_evaluations')
    .values({
      installation_id: tenant.installationId,
      repository_id: tenant.repositoryId,
      pr_number: 8,
      head_sha: 'b'.repeat(40),
      result: 'in_progress',
    })
    .execute();
  const row = await db
    .selectFrom('pr_evaluations')
    .select('details')
    .where('pr_number', '=', 8)
    .executeTakeFirstOrThrow();
  expect(row.details).toEqual({});
  expect(parseStoredDetails(row.details)).toEqual({ ok: false });
});
