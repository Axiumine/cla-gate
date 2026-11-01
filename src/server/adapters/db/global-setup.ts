// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { randomBytes } from 'node:crypto';
import process from 'node:process';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Connection string of the throw-away Postgres database of this run; undefined means "use PGlite". */
    testDatabaseUrl: string | undefined;
  }
}

/**
 * Vitest globalSetup of the `server` project (a test setup file: it runs once in the main process).
 *
 * With `DATABASE_URL` set, the suite runs against that Postgres server, but never inside the database it names: this
 * creates a dedicated `cla_test_<random>` database (the user needs CREATEDB), hands its URL to the tests through
 * `inject('testDatabaseUrl')`, and drops it afterwards. Without `DATABASE_URL` the tests use in-memory PGlite.
 */
export default async function setup(project: TestProject): Promise<(() => Promise<void>) | undefined> {
  const url = process.env['DATABASE_URL'] ?? '';
  if (url === '') {
    project.provide('testDatabaseUrl', undefined);
    return undefined;
  }
  const name = `cla_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`create database ${admin.escapeIdentifier(name)}`);
  const target = new URL(url);
  target.pathname = `/${name}`;
  project.provide('testDatabaseUrl', target.href);
  return async () => {
    await admin.query(`drop database if exists ${admin.escapeIdentifier(name)} with (force)`);
    await admin.end();
  };
}
