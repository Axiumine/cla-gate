// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import type { KyselyPlugin } from 'kysely';
import { type Kysely, PostgresQueryCompiler, sql } from 'kysely';
import type { GithubId } from '../../../shared/github-id.ts';
import { parseGithubId } from '../../../shared/github-id.ts';
import { insertSignature, type Signer } from '../../adapters/db/erasure-fixture/test-support.ts';
import type { Database } from '../../adapters/db/schema.ts';
import { migratedRuntimeDatabase, seedTenant, type Tenant } from '../../adapters/db/test-support.ts';

// The world the tests of the operator's erasure command share (E22-S05): three tenants, the person to erase, who signed in the
// first two and not in the third, a bystander who signed in the same two, and a stranger who signed in the third. The database is
// the migrated test database with the runtime role present, so the grants of `cla_app` are those of a real install.

/** The person to erase, a bystander in the same tenants, and a stranger in the third. */
export const TARGET = 4242;
export const BYSTANDER = 5353;
export const STRANGER = 6464;
/** The operator who asks, the actor of the audit rows. */
export const ACTOR = 9001;

export const target = parseGithubId(TARGET);
export const operator: GithubId = parseGithubId(ACTOR);

/** The personal data one signature holds. */
export interface PersonalData {
  readonly name: string;
  readonly email: string;
  readonly login: string;
}

/** The personal data a person signs with when a test does not choose it: made from the GitHub id, like `seedSignature` does. */
const dataOf = (githubId: number): PersonalData => ({
  name: `Name ${githubId}`,
  email: `u${githubId}@example.test`,
  login: `login-${githubId}`,
});

/** The person with this GitHub id, stored once whatever the number of tenants they sign in. */
async function personWith(db: Kysely<Database>, githubId: number, login: string): Promise<Signer> {
  const existing = await db.selectFrom('users').select('id').where('github_id', '=', githubId).executeTakeFirst();
  if (existing !== undefined) {
    return { userId: existing.id, githubId };
  }
  const row = await db
    .insertInto('users')
    .values({ github_id: githubId, login, name: `Name ${githubId}`, avatar_url: 'https://avatars.example/u' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { userId: row.id, githubId };
}

/** Signs the document of the tenant as the person, with the personal data `data` (none: the signature has no row of it). */
export async function signAs(
  db: Kysely<Database>,
  tenant: Tenant,
  githubId: number,
  data: PersonalData | null = dataOf(githubId),
): Promise<Signer & { readonly signatureId: number }> {
  const signer = await personWith(db, githubId, data?.login ?? `login-${githubId}`);
  const signatureId = await insertSignature(db, tenant, signer);
  if (data !== null) {
    await db
      .insertInto('signer_pii')
      .values({ signature_id: signatureId, user_id: signer.userId, ...data })
      .execute();
  }
  return { ...signer, signatureId };
}

export interface ErasureWorld {
  readonly db: Kysely<Database>;
  readonly t1: Tenant;
  readonly t2: Tenant;
  readonly t3: Tenant;
}

/** The three tenants, the target and the bystander in the first two, the stranger in the third. `data` is what the target signs with. */
export async function erasureWorld(data: PersonalData = dataOf(TARGET)): Promise<ErasureWorld> {
  const { db } = await migratedRuntimeDatabase();
  const t1 = await seedTenant(db, 1);
  const t2 = await seedTenant(db, 2);
  const t3 = await seedTenant(db, 3);
  for (const tenant of [t1, t2]) {
    await signAs(db, tenant, TARGET, data);
    await signAs(db, tenant, BYSTANDER);
  }
  await signAs(db, t3, STRANGER);
  return { db, t1, t2, t3 };
}

/** The audit rows the erasure function wrote, in order, as the columns that say who, where and what. */
export function erasureAudit(db: Kysely<Database>) {
  return db
    .selectFrom('audit_log')
    .select(['installation_id', 'actor_github_id', 'action', 'subject_type', 'subject_id', 'metadata'])
    .where('action', '=', 'signer_pii.erased')
    .orderBy('id')
    .execute();
}

/** Every row the erasure must not touch, as plain data: the signature cores of everyone, and the rows of personal data and the users of everyone but `githubId`. */
export async function othersOf(db: Kysely<Database>, githubId: number) {
  const user = await db.selectFrom('users').select('id').where('github_id', '=', githubId).executeTakeFirstOrThrow();
  return {
    signatures: await db.selectFrom('signatures').selectAll().orderBy('id').execute(),
    signerPii: await db
      .selectFrom('signer_pii')
      .selectAll()
      .where('user_id', '!=', user.id)
      .orderBy('signature_id')
      .execute(),
    users: await db.selectFrom('users').selectAll().where('id', '!=', user.id).orderBy('id').execute(),
    allowlist: await db.selectFrom('allowlist_entries').selectAll().orderBy('id').execute(),
  };
}

/** The rows of personal data the person holds, by installation: `[installation id, signature id]`. */
export async function rowsOf(db: Kysely<Database>, githubId: number): Promise<(readonly [number, number])[]> {
  const rows = await db
    .selectFrom('signer_pii as p')
    .innerJoin('signatures as s', 's.id', 'p.signature_id')
    .innerJoin('users as u', 'u.id', 'p.user_id')
    .where('u.github_id', '=', githubId)
    .select(['s.installation_id', 'p.signature_id'])
    .orderBy('s.installation_id')
    .execute();
  return rows.map((row) => [row.installation_id, row.signature_id] as const);
}

/** The login, name and avatar of the person's `users` row. */
export function snapshotOf(db: Kysely<Database>, githubId: number) {
  return db
    .selectFrom('users')
    .select(['login', 'name', 'avatar_url'])
    .where('github_id', '=', githubId)
    .executeTakeFirstOrThrow();
}

// -------------------------------------------------------------------------------------------------------- plugins

/** The text of the statement and its parameters, as the plugin sees them. */
interface Seen {
  readonly sql: string;
  readonly parameters: readonly unknown[];
}

/**
 * A plugin that throws `error` when the `nth` statement (counting from 1) that `matches` is about to be sent, and lets every
 * other statement through. Added to a handle with `db.withPlugin(...)`.
 */
export function failStatement(matches: (seen: Seen) => boolean, nth: number, error: unknown): KyselyPlugin {
  const compiler = new PostgresQueryCompiler();
  let count = 0;
  return {
    transformQuery: (args) => {
      const { sql: text, parameters } = compiler.compileQuery(args.node, args.queryId);
      if (matches({ sql: text, parameters })) {
        count += 1;
        if (count === nth) {
          throw error;
        }
      }
      return args.node;
    },
    transformResult: (args) => Promise.resolve(args.result),
  };
}

/** A plugin that records every statement it sees, and changes nothing. */
export function recordSql(): { readonly plugin: KyselyPlugin; readonly statements: string[] } {
  const compiler = new PostgresQueryCompiler();
  const statements: string[] = [];
  const plugin: KyselyPlugin = {
    transformQuery: (args) => {
      statements.push(compiler.compileQuery(args.node, args.queryId).sql);
      return args.node;
    },
    transformResult: (args) => Promise.resolve(args.result),
  };
  return { plugin, statements };
}

/** True for the statement that calls the erasure function for the installation `installationId`. */
export const callFor =
  (installationId: number) =>
  (seen: Seen): boolean =>
    seen.sql.includes('erase_signer_pii') && seen.parameters.includes(installationId);

/** True for the read of the person's `users` row, which starts each footprint. */
export const footprintRead = (seen: Seen): boolean => seen.sql.includes('from "users" where "github_id"');

/**
 * Replaces the erasure function by one that does nothing but answer zero, as the owner of the database. The runtime role still
 * holds its `execute` (a replaced function keeps its grants), so the command runs against a function that does not erase.
 */
export async function replaceWithNoOp(db: Kysely<Database>): Promise<void> {
  await sql`
    create or replace function erase_signer_pii(p_github_id bigint, p_actor_github_id bigint, p_installation_id bigint)
    returns integer language sql as 'select 0'`.execute(db);
}
