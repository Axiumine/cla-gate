// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { expect, onTestFinished, test, vi } from 'vitest';
import { z } from 'zod';
import { secretDirectory } from '../../config/secret-fixture/test-support.ts';
import { TEST_SETUP_TOKEN } from '../../config/test-support.ts';
import { loadMigrationFiles } from '../db/migration-files.ts';
import { migrate } from '../db/migrator.ts';
import { openPgliteDatabase } from '../db/pglite.ts';
import type { Database } from '../db/schema.ts';
import { MIGRATIONS_DIRECTORY } from '../db/test-support.ts';
import {
  convertWorld,
  FAKE_CODE,
  idOf,
  issueManifestState,
  MADE_UP_APP,
  MADE_UP_SECRETS,
  postConvert,
} from './setup-convert-fixture/test-support.ts';
import { postUnlock } from './setup-fixture/test-support.ts';

// E19-S11: the credentials are returned once and kept nowhere. A whole flow against a fake GitHub runs on a database that has
// every migration, and afterwards the log, every table and every write to a file are searched for each secret, in the three
// ways a value can be written down (as it is, in hex and in base64). The four events of the setup carry the request id only,
// and no audit row exists, because no actor does.

/** A value as it can be written down: as it is, as hex and as base64, so a secret stored in another encoding is found too. */
const spellings = (value: string): string[] => [
  value,
  Buffer.from(value).toString('hex'),
  Buffer.from(value).toString('base64'),
  Buffer.from(value).toString('base64url'),
];

/** Every secret of the conversion, and the pieces a log or a file could hold of the key (its body line, without the armour). */
const NEEDLES = [...MADE_UP_SECRETS, 'made-up-private-key-VALUE-0004'].flatMap(spellings);

/** A PGlite with every migration applied, for one test: the app that is given it closes it. */
async function migratedDatabase(): Promise<Kysely<Database>> {
  const db = await openPgliteDatabase();
  await migrate(db, await loadMigrationFiles(MIGRATIONS_DIRECTORY));
  return db;
}

/** The tables of every schema but the system ones, found in the catalogue and not listed by hand. */
async function tableNames(db: Kysely<Database>): Promise<string[]> {
  const { rows } = await sql<{ name: string }>`
    select table_schema || '.' || table_name as name from information_schema.tables
    where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema')
    order by 1`.execute(db);
  return rows.map((row) => row.name);
}

/** The tables, whole rows read as text (every column of every type), that hold at least one of the `needles` anywhere. */
async function tablesHolding(db: Kysely<Database>, needles: readonly string[]): Promise<string[]> {
  const found = await Promise.all(
    (await tableNames(db)).map(async (name) => {
      const matches = sql.join(
        needles.map((needle) => sql`strpos(t::text, ${needle}) > 0`),
        sql` or `,
      );
      const { rows } = await sql<{ n: number }>`
        select count(*)::int as n from ${sql.table(name)} as t where ${matches}`.execute(db);
      return rows[0]?.n === 0 ? [] : [name];
    }),
  );
  return found.flat();
}

/** The text of one argument of a write: a string as it is, bytes as text. */
const textOf = (argument: unknown): string => {
  if (typeof argument === 'string') {
    return argument;
  }
  return ArrayBuffer.isView(argument)
    ? Buffer.from(argument.buffer, argument.byteOffset, argument.byteLength).toString('latin1')
    : '';
};

const listOf = z.array(z.unknown());

/** The arguments of one call, with a list among them (`writev` takes a list of buffers) opened into its items. */
function argumentsOf(call: unknown): unknown[] {
  return listOf
    .catch([])
    .parse(call)
    .flatMap((argument) => {
      const inner = listOf.safeParse(argument);
      return inner.success ? inner.data : [argument];
    });
}

/**
 * Watches every way the process can write a file through `node:fs` (the callback, synchronous and promise forms, writes to a
 * descriptor and write streams) until the test ends, and keeps what each call was given. The named imports of the modules
 * that were loaded before are made to see the spies as well.
 */
function watchFileWrites(): { written(): string } {
  const spies = [
    vi.spyOn(fs, 'writeFile'),
    vi.spyOn(fs, 'writeFileSync'),
    vi.spyOn(fs, 'appendFile'),
    vi.spyOn(fs, 'appendFileSync'),
    vi.spyOn(fs, 'write'),
    vi.spyOn(fs, 'writeSync'),
    vi.spyOn(fs, 'writev'),
    vi.spyOn(fs, 'writevSync'),
    vi.spyOn(fs, 'createWriteStream'),
    vi.spyOn(fs.promises, 'writeFile'),
    vi.spyOn(fs.promises, 'appendFile'),
  ];
  syncBuiltinESMExports();
  onTestFinished(() => {
    vi.restoreAllMocks();
    syncBuiltinESMExports();
  });
  return {
    written: () =>
      spies
        .flatMap((spy) => spy.mock.calls.flatMap(argumentsOf))
        .map(textOf)
        .join('\n'),
  };
}

test('the watch on file writes sees a write, so an empty result means something', () => {
  const watch = watchFileWrites();
  const directory = secretDirectory();
  directory.write('control', 'LEAKCANARY-CONTROL');
  directory.write('second', Buffer.from('LEAKCANARY-BYTES'));
  expect(watch.written()).toContain('LEAKCANARY-CONTROL');
  expect(watch.written()).toContain('LEAKCANARY-BYTES');
});

test('the search of the tables finds a value that is stored, in the table that holds it, and nothing else', async () => {
  const db = await migratedDatabase();
  onTestFinished(async () => {
    await db.destroy();
  });
  const { rows } = await sql<{ name: string }>`select name from schema_migrations limit 1`.execute(db);
  const name = rows[0]?.name ?? '';
  expect(name).not.toBe('');
  expect(await tablesHolding(db, [name])).toEqual(['public.schema_migrations']);
  expect(await tableNames(db)).toEqual(expect.arrayContaining(['public.audit_log', 'public.signer_pii']));
});

test('a whole flow leaves the credentials in the answer alone: not in the log, not in any table, not in any file written', async () => {
  const watch = watchFileWrites();
  const db = await migratedDatabase();
  const { app, unlocked, logs, github } = await convertWorld({ db });
  const state = await issueManifestState(app, unlocked);
  const response = await postConvert(app, unlocked, state);
  expect(response.statusCode).toBe(200);
  expect(response.body).toContain(MADE_UP_APP.clientSecret);
  expect(github.requests).toHaveLength(1);
  const sensitive = [...NEEDLES, FAKE_CODE, state, unlocked.csrfToken, idOf(unlocked.cookie), TEST_SETUP_TOKEN];
  for (const needle of sensitive) {
    expect(logs.text()).not.toContain(needle);
  }
  expect(await tablesHolding(db, NEEDLES)).toEqual([]);
  for (const needle of NEEDLES) {
    expect(watch.written()).not.toContain(needle);
  }
});

test("a failed conversion leaves nothing either: GitHub's body is in no log, table or file", async () => {
  const watch = watchFileWrites();
  const db = await migratedDatabase();
  const { app, unlocked, logs, github } = await convertWorld({ db });
  const state = await issueManifestState(app, unlocked);
  const body = { message: 'LEAKCANARY-GITHUB-SAID', client_secret: MADE_UP_APP.clientSecret, pem: MADE_UP_APP.pem };
  github.answerNext(() => Response.json(body, { status: 500 }));
  github.answerNext(() => Response.json(body, { status: 404 }));
  expect((await postConvert(app, unlocked, state)).statusCode).toBe(502);
  expect((await postConvert(app, unlocked, state)).statusCode).toBe(400);
  const needles = [...NEEDLES, 'LEAKCANARY-GITHUB-SAID'];
  expect(logs.text()).not.toContain('LEAKCANARY-GITHUB-SAID');
  for (const needle of needles) {
    expect(logs.text()).not.toContain(needle);
    expect(watch.written()).not.toContain(needle);
  }
  expect(await tablesHolding(db, needles)).toEqual([]);
});

test('the setup writes no audit row, whatever happens: no actor exists before the App does', async () => {
  const db = await migratedDatabase();
  const { app, unlocked } = await convertWorld({ db });
  await postUnlock(app, 'a wrong token');
  await postConvert(app, unlocked, await issueManifestState(app, unlocked));
  await postConvert(app, unlocked, 'A'.repeat(43));
  const { rows } = await sql<{ n: number }>`select count(*)::int as n from audit_log`.execute(db);
  expect(rows[0]?.n).toBe(0);
});
