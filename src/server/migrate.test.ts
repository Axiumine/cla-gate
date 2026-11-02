// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import process from 'node:process';
import { expect, onTestFinished, test, vi } from 'vitest';
import { exists } from '../../scripts/ci/lib/test-support.ts';
import type { MigrateCliOptions } from './adapters/db/migrate-cli.ts';

// migrate.ts runs on import: these tests are its entry test. The success path is covered through runMigrateCli.

async function importMigrate(databaseUrl: string): Promise<string> {
  vi.stubEnv('DATABASE_URL', databaseUrl);
  vi.stubEnv('MIGRATION_DATABASE_URL', '');
  vi.resetModules();
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  onTestFinished(() => {
    vi.unstubAllEnvs();
    process.exitCode = undefined;
  });
  await import('./migrate.ts');
  return stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
}

test('the entry finds the migrations directory, tries the database and fails with exit code 1 when it is down', async () => {
  const printed = await importMigrate('postgres://owner:s3cr3t-pw@127.0.0.1:1/cla');
  expect(process.exitCode).toBe(1);
  expect(printed).toContain('migration failed: ');
  expect(printed).toContain('ECONNREFUSED');
  expect(printed).not.toContain('ENOENT');
  expect(printed).not.toContain('s3cr3t-pw');
});

test('the entry hands the CLI the migrations folder of the repository and the process environment', async () => {
  const runMigrateCli = vi.fn<(options: MigrateCliOptions) => Promise<number>>(() => Promise.resolve(0));
  vi.doMock('./adapters/db/migrate-cli.ts', () => ({ runMigrateCli }));
  vi.resetModules();
  onTestFinished(() => {
    vi.doUnmock('./adapters/db/migrate-cli.ts');
    process.exitCode = undefined;
  });
  await import('./migrate.ts');
  const options = runMigrateCli.mock.calls[0]?.[0];
  expect(options?.env).toBe(process.env);
  expect(exists(path.join(options?.directory ?? '', '001_initial.sql'))).toBe(true);
  expect(process.exitCode).toBe(0);
});

test('the entry reports an invalid environment by variable name', async () => {
  const printed = await importMigrate('');
  expect(process.exitCode).toBe(1);
  expect(printed).toBe('migration failed: Invalid environment configuration: DATABASE_URL\n');
});
