// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { randomBytes } from 'node:crypto';
import process from 'node:process';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import {
  ALLOW_APP_DATABASE,
  APP_DATABASE_QUERY,
  type Inspection,
  refusalFor,
  testDatabaseUrl,
} from './test-database-guard/test-support.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Connection string of the throw-away Postgres database of this run; undefined means "use PGlite". */
    testDatabaseUrl: string | undefined;
  }
}

/** What the setup needs of the environment and of the Vitest project: `process.env` and `TestProject` satisfy it. */
export type SetupEnv = Readonly<Record<string, string | undefined>>;
export type SetupProject = Pick<TestProject, 'provide'>;

/**
 * The setup behind {@link setup}, with the environment and the project passed in so that a test can run it against a server
 * of its own. Without `DATABASE_URL` there is nothing to prepare and the tests use PGlite. With it, the setup connects to the
 * database the URL names, refuses to go on when that database holds `schema_migrations` (unless `CLA_TEST_ALLOW_APP_DATABASE`
 * is `1`, E19-S10), and otherwise creates `cla_test_<random>`. The named database is only read, never written.
 */
export async function setupTestDatabase(
  project: SetupProject,
  env: SetupEnv,
): Promise<(() => Promise<void>) | undefined> {
  const { DATABASE_URL: url = '', [ALLOW_APP_DATABASE]: allowed } = env;
  if (url === '') {
    project.provide('testDatabaseUrl', undefined);
    return undefined;
  }
  const name = `cla_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  const { rows } = await admin.query<Inspection>(APP_DATABASE_QUERY);
  // A select without a table always answers one row; should it ever not, the run is refused rather than let through.
  const refusal = refusalFor(rows.at(0) ?? { name: '', holds_migrations: true }, allowed);
  if (refusal !== undefined) {
    await admin.end();
    throw new Error(refusal);
  }
  await admin.query(`create database ${admin.escapeIdentifier(name)}`);
  project.provide('testDatabaseUrl', testDatabaseUrl(url, name));
  return async () => {
    await admin.query(`drop database if exists ${admin.escapeIdentifier(name)} with (force)`);
    await admin.end();
  };
}

/**
 * Vitest globalSetup of the `server` project (a test setup file: it runs once in the main process).
 *
 * With `DATABASE_URL` set, the suite runs against that Postgres server, but never inside the database it names: this
 * creates a dedicated `cla_test_<random>` database (the user needs CREATEDB), hands its URL to the tests through
 * `inject('testDatabaseUrl')`, and drops it afterwards. A database that already holds `schema_migrations` is refused
 * (E19-S10). Without `DATABASE_URL` the tests use in-memory PGlite.
 */
export default function setup(project: TestProject): Promise<(() => Promise<void>) | undefined> {
  return setupTestDatabase(project, process.env);
}
