// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { serverSources } from '../adapters/db/tenant-scan/test-support.ts';
import { sourceTree } from '../source-tree/test-support.ts';
import { auditInsertions } from './audit-scan/test-support.ts';

// No second writer (E16-S01): the audit table is written by `appendAudit` and by nothing else in the code of `src`. The
// migrations hold the two SQL functions that append rows themselves (the erasure of E16-S04 and the purge of E16-S05);
// they are not part of this scan, and the schema tests of those stories pin what they write.

const SOURCE = sourceTree(path.resolve(import.meta.dirname, '../..'));
const WRITER = 'server/services/audit.ts';

function read(file: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test: `file` comes from the listing of the source directory
  return fs.readFileSync(path.join(SOURCE, file), 'utf8');
}

const sources = serverSources(SOURCE);

test('the scan covers the writer and the rest of the server', () => {
  expect(sources).toContain(WRITER);
  expect(sources.length).toBeGreaterThan(100);
});

test('the audit writer inserts into audit_log with one Kysely call and nothing else', () => {
  expect(auditInsertions(WRITER, read(WRITER))).toEqual(["insertInto('audit_log')"]);
});

test('no file of src other than the audit writer holds an insert into audit_log, in Kysely or in SQL', () => {
  const second = sources
    .filter((file) => file !== WRITER)
    .flatMap((file) => auditInsertions(file, read(file)).map((kind) => `${file}: ${kind}`));
  expect(second).toEqual([]);
});
