// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/** A migration as the runner sees it: its file name, its SQL and the SHA-256 of that SQL. */
export interface MigrationFile {
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

/** Thrown for anything wrong with the set of migrations or with the database's record of them. */
export class MigrationError extends Error {
  override readonly name = 'MigrationError';
}

/** `NNN_snake_case.sql`: exactly three digits, so the file names sort in numeric order. */
const NAME = /^(\d{3})_[a-z][a-z0-9_]*\.sql$/;

/** Plain code point order, so the result never depends on the locale or on the database collation. */
export function byName(a: { readonly name: string }, b: { readonly name: string }): number {
  if (a.name === b.name) {
    return 0;
  }
  // Stryker disable next-line EqualityOperator: equal names returned 0 above, so < and <= agree on everything that gets here
  return a.name < b.name ? -1 : 1;
}

/** @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode). */
export function toMigrationFile(name: string, sql: string): MigrationFile {
  // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- NAME is anchored with no nested quantifier (linear time); not a request handler
  if (!NAME.test(name)) {
    throw new MigrationError(`invalid migration file name ${JSON.stringify(name)}: expected NNN_snake_case.sql`);
  }
  return { name, sql, checksum: createHash('sha256').update(sql, 'utf8').digest('hex') };
}

function assertUniqueNumbers(files: readonly MigrationFile[]): void {
  const seen = new Set<string>();
  for (const file of files) {
    const number = file.name.slice(0, 3);
    if (seen.has(number)) {
      throw new MigrationError(`two migrations share the number ${number}`);
    }
    seen.add(number);
  }
}

/** Reads `directory/NNN_name.sql`, ordered by name. Other file types are ignored; a malformed `.sql` name is an error. */
export async function loadMigrationFiles(directory: string): Promise<MigrationFile[]> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the directory is fixed by the caller (the migrations folder), never user input
  const names = (await readdir(directory)).filter((name) => name.endsWith('.sql'));
  const files = await Promise.all(
    names.map(async (name) => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- name comes from readdir of the migrations directory, which the caller fixed
      const sql = await readFile(path.join(directory, name), 'utf8');
      return toMigrationFile(name, sql);
    }),
  );
  const ordered = files.toSorted(byName);
  assertUniqueNumbers(ordered);
  return ordered;
}
