// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { type Kysely, sql } from 'kysely';
import type { Database } from '../../adapters/db/schema.ts';

// Reading docs/privacy.md for the tests that keep it true (E16-S07): the tables between named markers, and the live
// columns of the migrated database they are compared with.

/** The privacy notes for operators. */
const PRIVACY_DOC = path.resolve(import.meta.dirname, '../../../../docs/privacy.md');

/** The text of the privacy notes. */
export function readPrivacyDoc(): string {
  return fs.readFileSync(PRIVACY_DOC, 'utf8');
}

/** A table between `<!-- name:start -->` and `<!-- name:end -->`: its two first lines as written, then one array of cells per row. */
export interface MarkedTable {
  readonly header: string;
  readonly separator: string;
  readonly rows: readonly (readonly string[])[];
}

/** The cells of one table line, trimmed: `| a | b |` is `['a', 'b']`. */
export function cellsOf(line: string): string[] {
  return line
    .trim()
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
}

/** A cell without the backticks of a code span: `` `users.login` `` is `users.login`. */
export function unquote(cell: string): string {
  return cell.replaceAll('`', '');
}

/** How many times `needle` occurs in `text`. */
function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/**
 * The table between the markers of `name`. Both markers must be present exactly once, in order, and a table (a header and
 * a separator at least) must stand between them: anything else throws, so a renamed marker fails loudly and is never read as
 * an empty table. Lines between the markers that do not start with `|` are ignored.
 */
export function markedTable(markdown: string, name: string): MarkedTable {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  if (occurrences(markdown, start) !== 1 || occurrences(markdown, end) !== 1) {
    throw new Error(`the markers ${start} and ${end} must each appear exactly once`);
  }
  const between = markdown.slice(markdown.indexOf(start) + start.length, markdown.indexOf(end));
  const [header, separator, ...rows] = between
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'));
  if (header === undefined || separator === undefined) {
    throw new Error(`no table between ${start} and ${end}`);
  }
  return { header, separator, rows: rows.map(cellsOf) };
}

/** A column name that suggests a person: the pattern of the drift test of the inventory. */
export const PERSONAL_COLUMN_PATTERN = /name|email|login|avatar|ip_address|user_agent|snapshot/;

/** Every column of the application tables (`public`, without the migration ledger), as `table.column`, sorted. */
export async function liveColumns(db: Kysely<Database>): Promise<string[]> {
  const { rows } = await sql<{ name: string }>`
    select table_name || '.' || column_name as name from information_schema.columns
    where table_schema = 'public' and table_name <> 'schema_migrations'`.execute(db);
  return rows.map((row) => row.name).toSorted((a, b) => a.localeCompare(b));
}

const SECONDS_PER_UNIT: ReadonlyMap<string, number> = new Map([
  ['hours', 3600],
  ['days', 86_400],
]);

/** A duration as the document writes it, `30 days` or `8 hours`, in seconds. Another unit throws. */
export function durationSeconds(text: string): number {
  const [amount = '', unit = ''] = text.split(' ');
  const perUnit = SECONDS_PER_UNIT.get(unit);
  if (!/^\d+$/.test(amount) || perUnit === undefined) {
    throw new Error(`not a duration the document uses: ${text}`);
  }
  return Number(amount) * perUnit;
}
