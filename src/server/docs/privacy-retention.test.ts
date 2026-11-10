// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { ConfigError } from '../config/config-error.ts';
import { type AppConfig, loadConfig } from '../config/env.ts';
import { buildEnvSchema } from '../config/env-schema.ts';
import { durationSeconds, markedTable, readPrivacyDoc, unquote } from './privacy-doc/test-support.ts';

// The retention table of docs/privacy.md against the defaults and limits of the code (E16-S07): the number in the document is
// the number the software enforces, and the data without a setting is the data that has none.

const DATABASE_URL = 'postgres://cla_app:made-up@db.example.test:5432/cla';
const SECONDS_PER_DAY = 86_400;

const table = markedTable(readPrivacyDoc(), 'retention');
const rows = table.rows.map(([data = '', fallback = '', limit = '', setting = '']) => ({
  data,
  fallback,
  limit,
  setting: unquote(setting),
}));
const rowOf = (setting: string) => rows.find((row) => row.setting === setting);

test('the retention table has the header and the separator of the document', () => {
  expect(table.header).toBe('| Data | Default | Limit | Setting |');
  expect(table.separator).toBe('|---|---|---|---|');
  expect(table.rows.map((cells) => cells.length)).toEqual(table.rows.map(() => 4));
});

// The configuration is loaded inside each test and not in a table at import: nothing of the configuration runs before a test.
test.each([
  ['NETWORK_METADATA_RETENTION_DAYS', (config: AppConfig) => config.networkMetadataRetentionDays * SECONDS_PER_DAY],
  ['SESSION_IDLE_SECONDS', (config: AppConfig) => config.session.idleSeconds],
  ['SESSION_ABSOLUTE_SECONDS', (config: AppConfig) => config.session.absoluteSeconds],
])('the default of %s in the document is the default of the environment schema', (setting, defaultSeconds) => {
  const row = rowOf(setting);
  expect(row, `${setting} has no row in the retention table`).toBeDefined();
  expect(durationSeconds(row?.fallback ?? '')).toBe(defaultSeconds(loadConfig({ DATABASE_URL })));
});

test('the limit of the network metadata retention in the document is the largest value the schema accepts', () => {
  const days = durationSeconds(rowOf('NETWORK_METADATA_RETENTION_DAYS')?.limit ?? '') / SECONDS_PER_DAY;
  const load = (value: number) => loadConfig({ DATABASE_URL, NETWORK_METADATA_RETENTION_DAYS: String(value) });
  expect(load(days).networkMetadataRetentionDays).toBe(days);
  expect(() => load(days + 1)).toThrow(ConfigError);
});

test('every setting the table names is a variable of the environment schema', () => {
  const named = rows.map((row) => row.setting).filter((setting) => /^[A-Z][A-Z0-9_]*$/.test(setting));
  expect(named.length).toBeGreaterThan(0);
  expect(named.filter((setting) => !Object.hasOwn(buildEnvSchema().shape, setting))).toEqual([]);
});

test.each([
  ['Signatures and CLA versions', 'indefinitely'],
  ['Audit log', 'indefinitely'],
  ['Name, email and login in `signer_pii`', 'until erased'],
])('%s is kept %s, with no setting and no limit', (data, kept) => {
  const row = rows.find((candidate) => candidate.data === data);
  expect(row).toEqual({ data, fallback: kept, limit: 'none', setting: 'none' });
});

test('the only retention settings in the environment schema are the network metadata one and the two of the operational rows (E22-S04)', () => {
  const retention = Object.keys(buildEnvSchema().shape).filter((name) => /RETENTION|PURGE|AUDIT|SIGNATURE/.test(name));
  expect(retention.toSorted((a, b) => a.localeCompare(b))).toEqual([
    'NETWORK_METADATA_RETENTION_DAYS',
    'RETENTION_BATCH_SIZE',
    'RETENTION_WEBHOOK_DELIVERIES_DAYS',
  ]);
});
