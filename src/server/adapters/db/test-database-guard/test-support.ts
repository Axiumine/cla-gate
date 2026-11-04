// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// The decisions of the global setup that need no server (E19-S10): which database a run was pointed at, whether the guard
// lets it through, what it says when it does not, and where the throw-away database goes. They live apart from the setup so
// that the 100% gate covers them on PGlite; `../global-setup.ts` only connects, asks and creates.

/** The variable that lets a run go ahead although `DATABASE_URL` names a database that holds `schema_migrations`. Only `1` counts. */
export const ALLOW_APP_DATABASE = 'CLA_TEST_ALLOW_APP_DATABASE';

/**
 * One row: the name of the database the connection reached, and whether that database holds a table `schema_migrations`,
 * the table that the migrator (E04) creates, in any schema but the system ones. The catalog is read directly, so the answer
 * does not depend on the search path of the role.
 */
export const APP_DATABASE_QUERY = `
  select
    current_database() as name,
    exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where c.relname = 'schema_migrations'
        and c.relkind in ('r', 'p')
        and n.nspname not in ('pg_catalog', 'information_schema')
    ) as holds_migrations`;

/** What {@link APP_DATABASE_QUERY} answers. */
export interface Inspection {
  readonly name: string;
  readonly holds_migrations: boolean;
}

/** The message of the refusal. It names the database and the way out, and never the URL (which holds the password). */
export function appDatabaseRefusal(database: string): string {
  return [
    `DATABASE_URL names the database ${JSON.stringify(database)}, which already contains schema_migrations:`,
    'it is an application database, not a test server. The test run refuses to start and has created nothing.',
    'Point DATABASE_URL at a dedicated test server (docs/development/test-database.md),',
    `or set ${ALLOW_APP_DATABASE}=1 when this database really is a throw-away one.`,
  ].join(' ');
}

/** The refusal for the database that was inspected, or `undefined` when the run may go ahead: the database holds no migrations table, or `allowed` is exactly `1`. */
export function refusalFor(found: Inspection, allowed: string | undefined): string | undefined {
  return found.holds_migrations && allowed !== '1' ? appDatabaseRefusal(found.name) : undefined;
}

/** `url` with its database replaced by `name`: host, credentials and options stay. */
export function testDatabaseUrl(url: string, name: string): string {
  const target = new URL(url);
  target.pathname = `/${name}`;
  return target.href;
}
