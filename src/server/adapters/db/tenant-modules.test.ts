// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { sourceTree } from '../../source-tree/test-support.ts';
import { TENANT_MODULES, TENANT_QUERIES } from './tenant-registry/test-support.ts';
import { queryGaps, scanProblems, serverSources, tenantTableUses } from './tenant-scan/test-support.ts';

// The registry of E11-S06 held to the server's source: no file runs a statement over a tenant table without being listed
// in TENANT_MODULES, and every function a listed file exports is in TENANT_QUERIES, which the generated test of
// tenant-queries-matrix.test.ts calls for two tenants. A query cannot be added without the cross-tenant check.

const SERVER = sourceTree(path.resolve(import.meta.dirname, '../..'));

function read(file: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test: `file` comes from the listing of the server's own source directory
  return fs.readFileSync(path.join(SERVER, file), 'utf8');
}

const sources = serverSources(SERVER);

test('every file of the server that runs a statement over a tenant table is in TENANT_MODULES, and nothing but the audit writer inserts audit rows', () => {
  const problems = sources.flatMap((file) => scanProblems(file, tenantTableUses(file, read(file)), TENANT_MODULES));
  expect(problems).toEqual([]);
});

test('every file of TENANT_MODULES exists and runs a statement over a tenant table, so the list names no file that does not belong', () => {
  expect(TENANT_MODULES.filter((file) => !sources.includes(file))).toEqual([]);
  expect(TENANT_MODULES.filter((file) => tenantTableUses(file, read(file)).length === 0)).toEqual([]);
});

test('TENANT_QUERIES has an entry for every module of TENANT_MODULES and for no other', () => {
  expect(Object.keys(TENANT_QUERIES).toSorted((a, b) => a.localeCompare(b))).toEqual(
    [...TENANT_MODULES].toSorted((a, b) => a.localeCompare(b)),
  );
});

test.each(Object.entries(TENANT_QUERIES))(
  '%s: every function it exports is in TENANT_QUERIES, and every entry names an export',
  (file, queries) => {
    expect(queryGaps(file, read(file), Object.keys(queries))).toEqual([]);
  },
);

test('a query that meets another tenant by design says why and names the test that pins it, which exists and names the function', () => {
  const byDesign = Object.entries(TENANT_QUERIES).flatMap(([file, queries]) =>
    Object.entries(queries).flatMap(([name, query]) => (query.kind === 'by_design' ? [{ file, name, query }] : [])),
  );
  expect(byDesign.map(({ name }) => name).toSorted((a, b) => a.localeCompare(b))).toEqual([
    'findPublicRepository',
    'findSignRepository',
    'installationOfRepository',
    'isActiveRepositoryOfAnotherInstallation',
    'listInstallationsForOperator',
    'ownAllowlistEntries',
    'ownAuditEntries',
    'ownSignatureRows',
    'ownSignatures',
    'releaseTransferred',
  ]);
  for (const { name, query } of byDesign) {
    expect(query.reason.length).toBeGreaterThan(40);
    expect(read(query.pinnedBy)).toContain(name);
  }
});
