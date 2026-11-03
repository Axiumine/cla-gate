// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { storedDetailsSample } from '../../shared/test-support.ts';
import { columnsHolding, textColumns } from '../adapters/db/erasure-fixture/test-support.ts';
import type { Database } from '../adapters/db/schema.ts';
import { migratedTestDatabase, seedSignature, seedTenant } from '../adapters/db/test-support.ts';
import { eraseSigner } from './signer-erasure.ts';
import { ACTOR } from './test-support.ts';

// Completeness of the erasure (E16-S04): after a person is erased, no text or JSON column of any table of the application
// holds their login, name or email. The columns come from `information_schema`, not from a list, so a later epic that adds a
// table or a column with a login snapshot fails here until `erase_signer_pii` handles it.

const LOGIN = 'sentinel-login-9c2e';
const NAME = 'Sentinel Name 9c2e';
const EMAIL = 'sentinel-9c2e@example.test';
const SENTINELS = [LOGIN, NAME, EMAIL] as const;
const PERSON = 111;
const PERSON_ID = parseGithubId(PERSON);

/**
 * A tenant with one signer whose login, name and email are the sentinels wherever the schema keeps them: the display snapshot,
 * the personal data of the signature, the addresses of a session, the login snapshot of an allowlist entry (a column E14
 * adds, added here) and, as E08 writes it, the details of an evaluation of the person's pull request, which hold their
 * numeric id and codes and so none of the three strings.
 */
async function seededWithSentinels(db: Kysely<Database>) {
  const tenant = await seedTenant(db);
  const signer = await seedSignature(db, tenant, PERSON);
  await db.updateTable('users').set({ login: LOGIN, name: NAME }).where('id', '=', signer.userId).execute();
  await db
    .updateTable('signer_pii')
    .set({ login: LOGIN, name: NAME, email: EMAIL })
    .where('signature_id', '=', signer.signatureId)
    .execute();
  await db
    .insertInto('sessions')
    .values({
      session_hash: 'a'.repeat(64),
      user_id: signer.userId,
      csrf_secret: 'csrf',
      idle_expires_at: new Date(Date.now() + 60_000),
      absolute_expires_at: new Date(Date.now() + 120_000),
      verified_emails: JSON.stringify([{ email: EMAIL, primary: true }]),
    })
    .execute();
  await sql`alter table allowlist_entries add column if not exists login_snapshot text`.execute(db);
  await sql`insert into allowlist_entries (installation_id, kind, github_id, created_by, login_snapshot)
            values (${tenant.installationId}, 'user', ${PERSON}, ${tenant.publisherId}, ${LOGIN})`.execute(db);
  const details = storedDetailsSample();
  await db
    .insertInto('pr_evaluations')
    .values({
      installation_id: tenant.installationId,
      repository_id: tenant.repositoryId,
      pr_number: 7,
      head_sha: 'a'.repeat(40),
      result: details.outcome,
      details: JSON.stringify({
        ...details,
        actors: details.actors.map((actor, index) => (index === 0 ? { ...actor, githubId: PERSON } : actor)),
      }),
    })
    .execute();
  return { tenant, signer };
}

test('the scan reads the columns from the catalogue and reaches the JSON ones, the evaluation details and the audit metadata among them', async () => {
  const { db } = await migratedTestDatabase();
  const columns = await textColumns(db);
  expect(columns).toEqual(
    expect.arrayContaining([
      'users.login',
      'users.name',
      'users.avatar_url',
      'signer_pii.name',
      'signer_pii.email',
      'signer_pii.login',
      'sessions.verified_emails',
      'pr_evaluations.details',
      'audit_log.metadata',
      'commit_overrides.reason',
    ]),
  );
  expect(columns).not.toContain('users.github_id');
});

test('before the erasure the scan finds the three strings in every place the schema keeps a login, a name or an email, and none in the evaluation details', async () => {
  const { db } = await migratedTestDatabase();
  await seededWithSentinels(db);
  expect(await columnsHolding(db, SENTINELS)).toEqual([
    'allowlist_entries.login_snapshot',
    'sessions.verified_emails',
    'signer_pii.email',
    'signer_pii.login',
    'signer_pii.name',
    'users.login',
    'users.name',
  ]);
  const details = await columnsHolding(db, [`"githubId": ${PERSON}`]);
  expect(details).toEqual(['pr_evaluations.details']);
});

test('after the erasure no text or JSON column of any table holds the login, the name or the email of the person', async () => {
  const { db } = await migratedTestDatabase();
  const { tenant } = await seededWithSentinels(db);

  await eraseSigner(db, tenant, { githubUserId: PERSON_ID, expectedRows: 1, actor: ACTOR });

  expect(await columnsHolding(db, SENTINELS)).toEqual([]);
});

test('a table that keeps a login snapshot and that the erasure does not handle fails the scan, so a later epic cannot add one unnoticed', async () => {
  const { db } = await migratedTestDatabase();
  const { tenant } = await seededWithSentinels(db);
  await sql`create table later_epic_snapshot (id integer primary key, owner_login text)`.execute(db);
  await sql`insert into later_epic_snapshot values (1, ${LOGIN})`.execute(db);

  await eraseSigner(db, tenant, { githubUserId: PERSON_ID, expectedRows: 1, actor: ACTOR });

  expect(await columnsHolding(db, SENTINELS)).toEqual(['later_epic_snapshot.owner_login']);
});
