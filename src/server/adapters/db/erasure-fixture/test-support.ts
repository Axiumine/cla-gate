// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { Database } from '../schema.ts';
import { publishVersion, seedSignature, seedTenant, sha256, type Tenant } from '../test-support.ts';

// A person who signed in two tenants (E16-S04): what the scoped erasure is tried on. `seedSignature` creates a new user for
// each signature, so the second signature is stored for the user the first one made.

/** A stored person: `users.id` and the numeric GitHub id. */
export interface Signer {
  readonly userId: number;
  readonly githubId: number;
}

/** A version of the tenant's document that a signature can name: `signatureOf` takes it, and the foreign key ties its three fields together. */
export interface SignedVersion {
  readonly id: number;
  readonly major: number;
  readonly sha256: string;
}

/** Publishes the next major of the document of the tenant, which a person who signed 1.0 can sign again. */
export async function publishSecondMajor(db: Kysely<Database>, tenant: Tenant): Promise<SignedVersion> {
  const text = 'Second major';
  const version = await publishVersion(db, tenant.documentId, tenant.publisherId, { major: 2, minor: 0, text });
  return { id: version.id, major: 2, sha256: sha256(text) };
}

/**
 * A signature of the tenant's document by an existing person, without the personal data held for it. A person has one active
 * signature per major, so a second one names the version `publishSecondMajor` returned.
 */
export async function insertSignature(
  db: Kysely<Database>,
  tenant: Tenant,
  signer: Signer,
  version?: SignedVersion,
): Promise<number> {
  const row = await db
    .insertInto('signatures')
    .values({
      installation_id: tenant.installationId,
      user_id: signer.userId,
      document_id: tenant.documentId,
      version_id: version?.id ?? tenant.versionId,
      major: version?.major ?? 1,
      content_sha256: version?.sha256 ?? tenant.contentSha256,
      consent_text_id: 'consent-v1',
      signer_type: 'individual',
      source_repository_id: tenant.repositoryId,
      source_pr_number: 7,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** The personal data a signature of this person holds, made from the GitHub id like `seedSignature` does. */
export async function storePii(db: Kysely<Database>, signatureId: number, signer: Signer): Promise<void> {
  await db
    .insertInto('signer_pii')
    .values({
      signature_id: signatureId,
      user_id: signer.userId,
      name: `Name ${signer.githubId}`,
      email: `u${signer.githubId}@example.test`,
      login: `login-${signer.githubId}`,
    })
    .execute();
}

/** An allowlist entry of the tenant for the account `githubId`, shown with the login `snapshot`: a person who may never have signed in or signed anything. */
export async function listAccount(
  db: Kysely<Database>,
  tenant: Tenant,
  githubId: number,
  snapshot: string | null,
): Promise<void> {
  await db
    .insertInto('allowlist_entries')
    .values({
      installation_id: tenant.installationId,
      kind: 'user',
      github_id: githubId,
      created_by: tenant.publisherId,
      login_snapshot: snapshot,
    })
    .execute();
}

/** The login snapshots of the allowlist, as (installation, account, snapshot), in a fixed order. */
export function snapshots(db: Kysely<Database>) {
  return db
    .selectFrom('allowlist_entries')
    .select(['installation_id', 'github_id', 'login_snapshot'])
    .orderBy('installation_id')
    .orderBy('github_id')
    .execute();
}

/** Two tenants (`seedTenant` 1 and 2) and one person who signed the document of each, with the personal data held for both. */
export async function sharedSigner(db: Kysely<Database>, githubId = 111) {
  const t1 = await seedTenant(db, 1);
  const t2 = await seedTenant(db, 2);
  const first = await seedSignature(db, t1, githubId);
  const person: Signer = { userId: first.userId, githubId };
  const secondSignatureId = await insertSignature(db, t2, person);
  await storePii(db, secondSignatureId, person);
  return { t1, t2, person, firstSignatureId: first.signatureId, secondSignatureId };
}

// ------------------------------------------------------------------------------------------------ the completeness scan

/** The kinds of column that can hold a login, a name or an email: text, the character types, JSON and arrays. */
const TEXT_KINDS = ['text', 'character varying', 'character', 'json', 'jsonb', 'ARRAY'];

/** Every text and JSON column of every table of the `public` schema, as `table.column`, found in the catalogue and not listed by hand. */
export async function textColumns(db: Kysely<Database>): Promise<string[]> {
  const { rows } = await sql<{ name: string }>`
    select c.table_name || '.' || c.column_name as name
    from information_schema.columns as c
    join information_schema.tables as t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.data_type = any(${sql.val(TEXT_KINDS)})
    order by c.table_name, c.ordinal_position`.execute(db);
  return rows.map((row) => row.name);
}

/**
 * The columns (`table.column`, found by {@link textColumns}), in alphabetical order, that hold at least one of the `strings`
 * anywhere in a value, as a substring of the text of the column (a JSON value is searched as text).
 */
export async function columnsHolding(db: Kysely<Database>, strings: readonly string[]): Promise<string[]> {
  const found = await Promise.all(
    (await textColumns(db)).map(async (name) => {
      const [table = '', column = ''] = name.split('.');
      const matches = sql.join(
        strings.map((text) => sql`strpos(${sql.ref(column)}::text, ${text}) > 0`),
        sql` or `,
      );
      const { rows } = await sql<{ n: number }>`
        select count(*)::int as n from ${sql.table(table)} where ${matches}`.execute(db);
      return rows[0]?.n === 0 ? [] : [name];
    }),
  );
  return found.flat().toSorted((a, b) => a.localeCompare(b));
}
