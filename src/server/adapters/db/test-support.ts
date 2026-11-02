// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { type Kysely, sql } from 'kysely';
import { afterAll, afterEach, expect, inject, test } from 'vitest';
import { type InstallationRowId, installationRowIdSchema } from './installation-row-id.ts';
import { loadMigrationFiles } from './migration-files.ts';
import { migrate } from './migrator.ts';
import { createPgDatabase } from './pg.ts';
import { openPgliteDatabase } from './pglite.ts';
import type { Database } from './schema.ts';

// The ONE way tests get a database. With DATABASE_URL set (see global-setup.ts) every test runs on a real Postgres, and
// otherwise on in-memory PGlite, so the same suite proves both. A test file shares one connection and gets a clean
// `public` schema per test.

export const MIGRATIONS_DIRECTORY = path.resolve(import.meta.dirname, '../../../../migrations');

/** True when the suite runs against a real Postgres server (the CI `postgres` job) and not against PGlite. */
export const realPostgres = inject('testDatabaseUrl') !== undefined;

export interface TestDatabase {
  readonly kind: 'pglite' | 'postgres';
  readonly db: Kysely<Database>;
}

/** A new connection to the test database: node-postgres when `url` is given (nothing connects yet), else PGlite. */
export async function openTestDatabase(url: string | undefined): Promise<TestDatabase> {
  if (url === undefined) {
    return { kind: 'pglite', db: await openPgliteDatabase() };
  }
  return { kind: 'postgres', db: createPgDatabase({ connectionString: url, onError: console.error }) };
}

/** Drops everything in `public`, including `schema_migrations`. The roles of the cluster stay. */
export async function resetDatabase(db: Kysely<Database>): Promise<void> {
  await sql`drop schema if exists public cascade`.execute(db);
  await sql`create schema public`.execute(db);
}

let shared: Promise<TestDatabase> | undefined;

afterAll(async () => {
  const open = shared;
  shared = undefined;
  await (await open)?.db.destroy();
});

/** The shared connection of this test file, with an empty `public` schema. */
export async function emptyTestDatabase(): Promise<TestDatabase> {
  shared ??= openTestDatabase(inject('testDatabaseUrl'));
  const database = await shared;
  await resetDatabase(database.db);
  return database;
}

/** {@link emptyTestDatabase} with every migration of `migrations/` applied. */
export async function migratedTestDatabase(): Promise<TestDatabase> {
  const database = await emptyTestDatabase();
  await migrate(database.db, await loadMigrationFiles(MIGRATIONS_DIRECTORY));
  return database;
}

/** Creates the runtime role `cla_app` (a cluster-wide object) unless it exists. Call before migrating to get its grants. */
export async function ensureRuntimeRole(db: Kysely<Database>): Promise<void> {
  await sql`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'cla_app') then
        create role cla_app login;
      end if;
    end
    $$`.execute(db);
}

/** {@link migratedTestDatabase} with the runtime role present first, so the migration grants `cla_app` its privileges. */
export async function migratedRuntimeDatabase(): Promise<TestDatabase> {
  const database = await emptyTestDatabase();
  await ensureRuntimeRole(database.db);
  await migrate(database.db, await loadMigrationFiles(MIGRATIONS_DIRECTORY));
  return database;
}

/** `expect.stringContaining` is typed `any`; as `unknown` it can sit in an object literal. */
export const containing = (text: string): unknown => expect.stringContaining(text);

// ----------------------------------------------------------------------------------------------- migration files

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

/** A temporary directory holding the given `name: sql` files, removed after the current test. */
export async function writeMigrationDirectory(files: Readonly<Record<string, string>>): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cla-migrations-'));
  temporaryDirectories.push(directory);
  await Promise.all(
    Object.entries(files).map(([name, text]) =>
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: inside a directory created by mkdtemp above
      fs.writeFile(path.join(directory, name), text, 'utf8'),
    ),
  );
  return directory;
}

// ------------------------------------------------------------------------------------------------------- seeding

/** One tenant: an installation with a repository, an individual CLA document and its published version 1.0. */
export interface Tenant {
  readonly installationId: InstallationRowId;
  readonly repositoryId: number;
  readonly documentId: number;
  readonly versionId: number;
  readonly publisherId: number;
  readonly contentSha256: string;
}

/** An `installations.id` for a row that may not exist (a stranger), or one read from a row plus an offset. */
export const rowId = (n: number): InstallationRowId => installationRowIdSchema.parse(n);

export const CLA_TEXT = 'I grant the project a perpetual licence to my contributions.';

/** Inserts a tenant. `n` makes every GitHub id unique, so two tenants can live in one database. */
export async function seedTenant(db: Kysely<Database>, n = 1): Promise<Tenant> {
  const publisher = await db
    .insertInto('users')
    .values({ github_id: n * 1000 + 1, login: `publisher-${n}`, name: null, avatar_url: null })
    .returning('id')
    .executeTakeFirstOrThrow();
  const installation = await db
    .insertInto('installations')
    .values({
      github_installation_id: n * 5000,
      account_id: n * 7000,
      account_login: `org-${n}`,
      account_type: 'Organization',
      suspended_at: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const repository = await db
    .insertInto('repositories')
    .values({
      installation_id: installation.id,
      github_repo_id: n * 9000,
      full_name: `org-${n}/repo`,
      cla_document_id: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const document = await db
    .insertInto('cla_documents')
    .values({
      installation_id: installation.id,
      repository_id: null,
      name: 'Individual CLA',
      kind: 'individual',
      active_version_id: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const contentSha256 = sha256(CLA_TEXT);
  const version = await publishVersion(db, document.id, publisher.id, { major: 1, minor: 0, text: CLA_TEXT });
  await db.updateTable('cla_documents').set({ active_version_id: version.id }).where('id', '=', document.id).execute();
  return {
    installationId: installation.id,
    repositoryId: repository.id,
    documentId: document.id,
    versionId: version.id,
    publisherId: publisher.id,
    contentSha256,
  };
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export interface VersionSpec {
  readonly major: number;
  readonly minor: number;
  readonly text: string;
}

export function publishVersion(
  db: Kysely<Database>,
  documentId: number,
  publisherId: number,
  spec: VersionSpec,
): Promise<{ id: number }> {
  return db
    .insertInto('cla_versions')
    .values({
      document_id: documentId,
      major: spec.major,
      minor: spec.minor,
      content_md: spec.text,
      content_sha256: sha256(spec.text),
      published_by: publisherId,
      rationale: 'test',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
}

/** A signed (not revoked) signature of version 1.0 by a new user, with its signer_pii row. */
export async function seedSignature(
  db: Kysely<Database>,
  tenant: Tenant,
  githubUserId: number,
): Promise<{ signatureId: number; userId: number }> {
  const user = await db
    .insertInto('users')
    .values({
      github_id: githubUserId,
      login: `login-${githubUserId}`,
      name: `Name ${githubUserId}`,
      avatar_url: 'https://avatars.example/u',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const signature = await db
    .insertInto('signatures')
    .values({
      installation_id: tenant.installationId,
      user_id: user.id,
      document_id: tenant.documentId,
      version_id: tenant.versionId,
      major: 1,
      content_sha256: tenant.contentSha256,
      consent_text_id: 'consent-v1',
      signer_type: 'individual',
      source_repository_id: tenant.repositoryId,
      source_pr_number: 7,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('signer_pii')
    .values({
      signature_id: signature.id,
      user_id: user.id,
      name: `Name ${githubUserId}`,
      email: `u${githubUserId}@example.test`,
      login: `login-${githubUserId}`,
    })
    .execute();
  return { signatureId: signature.id, userId: user.id };
}

/** Runs `work` in a transaction as the unprivileged runtime role (`set local role`), like the application does. */
export function asRuntimeRole<T>(db: Kysely<Database>, work: (trx: Kysely<Database>) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`set local role cla_app`.execute(trx);
    return work(trx);
  });
}

// -------------------------------------------------------------------------------- real-Postgres-only tests (E20-S03)
//
// PGlite has one session, so it cannot show a lock wait, a unique-index race or a backend that dies. Those tests run
// only against a real server (the CI `postgres` job) and are marked with `realPostgresOnly`. They add assertions and
// are never the only coverage of a line: the 100% gate runs on PGlite, where they are skipped.

export const NEEDS_REAL_POSTGRES = 'needs real Postgres';
export const NEEDS_ROLE_TESTS = 'needs CLA_ROLE_TESTS=1';
const REQUIRED_BUT_PGLITE =
  'REQUIRE_REAL_POSTGRES=1 but this run uses PGlite: set DATABASE_URL to a real Postgres server';

/** The engine behind the database URL of a run, as `TestDatabase.kind` names it: no URL means PGlite. */
export function engineOf(url: string | undefined): TestDatabase['kind'] {
  return url === undefined ? 'pglite' : 'postgres';
}

/** The engine of this run. */
export const DATABASE_KIND = engineOf(inject('testDatabaseUrl'));

type Environment = Readonly<Record<string, string | undefined>>;

/** What a real-Postgres-only test does in this run: run its body, skip with a reason, or fail. */
export type Gate =
  | { readonly action: 'run' }
  | { readonly action: 'skip'; readonly note: string }
  | { readonly action: 'fail'; readonly message: string };

/**
 * Real server: run. PGlite: skip with {@link NEEDS_REAL_POSTGRES}, unless `REQUIRE_REAL_POSTGRES=1` (the CI `postgres`
 * job) says a skip would hide a misconfigured job: then fail. Only the exact value `1` counts.
 */
export function realPostgresGate(kind: TestDatabase['kind'], env: Environment): Gate {
  if (kind === 'postgres') {
    return { action: 'run' };
  }
  if (env['REQUIRE_REAL_POSTGRES'] === '1') {
    return { action: 'fail', message: REQUIRED_BUT_PGLITE };
  }
  return { action: 'skip', note: NEEDS_REAL_POSTGRES };
}

/**
 * {@link realPostgresGate}, and on a real server additionally `CLA_ROLE_TESTS=1`: a test that creates or alters roles
 * touches the whole cluster, so it must never run against a server that somebody else shares by accident.
 */
export function realPostgresRolesGate(kind: TestDatabase['kind'], env: Environment): Gate {
  const gate = realPostgresGate(kind, env);
  if (gate.action !== 'run' || env['CLA_ROLE_TESTS'] === '1') {
    return gate;
  }
  return { action: 'skip', note: NEEDS_ROLE_TESTS };
}

/** Applies `gate` inside a running test: `skip` throws Vitest's skip signal, a failure throws, a run calls `body`. */
export async function runGated(gate: Gate, skip: (note: string) => never, body: () => Promise<void>): Promise<void> {
  if (gate.action === 'skip') {
    skip(gate.note);
  }
  if (gate.action === 'fail') {
    throw new Error(gate.message);
  }
  await body();
}

type Registered = (context: { readonly skip: (note: string) => never }) => Promise<void>;

/** How a gated test is registered and which engine the run uses; the tests of the wrappers hand in their own host. */
export interface GateHost {
  readonly register: (name: string, body: Registered) => void;
  readonly kind: TestDatabase['kind'];
}

const VITEST_HOST: GateHost = { register: test, kind: DATABASE_KIND };

/** Turns a gate into the registration function of a gated test: same name and body, plus an optional host. */
function gated(gate: typeof realPostgresGate): (name: string, body: () => Promise<void>, host?: GateHost) => void {
  return (name, body, { register, kind } = VITEST_HOST) => {
    register(name, (context) => runGated(gate(kind, process.env), context.skip, body));
  };
}

/** A test that needs a real Postgres server. Skipped with {@link NEEDS_REAL_POSTGRES} on PGlite, a failure under `REQUIRE_REAL_POSTGRES=1`. */
export const realPostgresOnly = gated(realPostgresGate);

/** {@link realPostgresOnly} for tests that create or alter cluster-wide roles: also skipped with {@link NEEDS_ROLE_TESTS} unless `CLA_ROLE_TESTS=1`. */
export const realPostgresRolesOnly = gated(realPostgresRolesGate);

export * from './real-postgres/test-support.ts';
