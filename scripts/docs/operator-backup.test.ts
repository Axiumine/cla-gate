// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';
import { findOnPath, readText } from '../ci/lib/test-support.ts';
import { readCompose, STACK_SUBNET, serviceNamed, withDefault } from '../compose/test-support.ts';
import { codeBlocks, guide, inOrder, ROOT, sectionsOf } from './test-support.ts';

// docs/operations/backup-restore.md against the stack (E19-S09): the commands are the ones the rehearsal of E19-S12 runs, the
// names in them exist in the compose file and the provisioning script, and the scripts it gives are valid shell.

const backup = guide('backup-restore');
const shell = codeBlocks(backup, 'sh');
const commands = shell.map((block) => block.text).join('\n');
const DUMP = 'docker compose exec -T postgres pg_dump -U cla_owner -Fc cla > cla.dump';
const RESTORE =
  'docker compose exec -T postgres pg_restore -U postgres -d cla --no-owner --role=cla_owner --clean --if-exists --exit-on-error < cla.dump';

/** The result of `sh -n` (parse, run nothing) on a block. */
function syntaxOf(script: string): { status: number | null; stderr: string } {
  const { status, stderr } = spawnSync(findOnPath('sh'), ['-n'], { input: script, encoding: 'utf8' });
  return { status, stderr };
}

test('the dump and the restore are the commands of the story, word for word', () => {
  expect(commands).toContain(DUMP);
  expect(commands).toContain(RESTORE);
  expect(commands).toContain('docker compose down -v');
  expect(commands).toContain('docker compose up -d --wait postgres');
  expect(
    inOrder(commands, [
      'down -v',
      'up -d --wait postgres',
      'pg_restore',
      'SOURCE_COMMIT=$(git rev-parse HEAD) docker compose up -d',
    ]),
  ).toBe(true);
});

test('the role, the database and the service in the commands are the ones the stack provisions', () => {
  const script = readText(path.join(ROOT, 'scripts/provision-database.sh'));
  expect(script).toContain('CLA_DB_NAME (default cla)');
  expect(script).toContain('CLA_OWNER_ROLE (default cla_owner)');
  expect(Object.keys(readCompose().services)).toContain('postgres');
});

test('pg_restore needs --clean --if-exists because provisioning has already created the schema pgboss', () => {
  expect(readText(path.join(ROOT, 'scripts/provision-database.sql'))).toContain('pgboss');
  expect(backup).toMatch(
    /--clean --if-exists. is there because the provisioning step has already created the schema `pgboss`/,
  );
});

test('the cluster is in the named volume, one level above the versioned data directory of the image the stack pins', () => {
  const compose = readCompose();
  const postgres = serviceNamed(compose, 'postgres');
  expect(postgres.image).toBe('postgres:18');
  expect(postgres.volumes).toContain('cla-postgres-data:/var/lib/postgresql');
  expect(Object.keys(compose.volumes)).toContain('cla-postgres-data');
  expect(backup).toContain(`${compose.name}_cla-postgres-data`);
  expect(backup).toContain('/var/lib/postgresql/18/docker');
  expect(backup).toContain('`cla-postgres-data`');
});

test('the rehearsal command prefix is the project name the page gives, with its own subnet so it never meets the running stack', () => {
  expect(commands).toContain('docker compose -p cla-rehearsal up -d --wait postgres');
  expect(commands).toContain('export EDGE_SUBNET=172.31.31.0/24');
  expect(commands).toContain('docker compose -p cla-rehearsal down -v');
  expect(readText(path.join(ROOT, 'docker-compose.yml'))).toContain(withDefault('EDGE_SUBNET', STACK_SUBNET));
});

test('the backup script writes a partial file, reads it back with pg_restore --list, and only then renames it', () => {
  const script = shell.find((block) => block.text.startsWith('#!/bin/sh'))?.text ?? '';
  expect(script).toContain('set -eu');
  expect(script).toContain('umask 077');
  expect(inOrder(script, ['pg_dump', '.dump.partial', 'pg_restore --list', 'mv ', '-mtime +14 -delete'])).toBe(true);
  expect(
    script
      .split('\n')
      .filter((line) => line.startsWith('docker compose exec'))
      .every((line) => line.includes(' -T ')),
  ).toBe(true);
  expect(syntaxOf(script)).toEqual({ status: 0, stderr: '' });
});

const [override] = codeBlocks(backup, 'yaml');
const overrideSchema = z.object({
  services: z.object({ postgres: z.object({ command: z.array(z.string()), volumes: z.array(z.string()) }) }),
});
const configured = overrideSchema.parse(parse(override?.text ?? ''));

test('the override for point-in-time recovery replaces the command with the image default plus three settings, and mounts the archive', () => {
  const { command, volumes } = configured.services.postgres;
  expect(serviceNamed(readCompose(), 'postgres').command).toBeUndefined();
  expect(command[0]).toBe('postgres');
  const settings = command.slice(1);
  expect(settings.filter((_, at) => at % 2 === 0)).toEqual(['-c', '-c', '-c']);
  expect(settings.filter((_, at) => at % 2 === 1)).toEqual([
    'archive_mode=on',
    'archive_command=test ! -f /wal-archive/%f && cp %p /wal-archive/%f',
    'archive_timeout=300',
  ]);
  expect(volumes).toEqual(['/srv/cla-wal-archive:/wal-archive']);
  expect(commandsOf('install -d')).toContain('/srv/cla-wal-archive');
  expect(backup).toContain('archive_timeout');
  expect(backup).toMatch(/at least every five minutes/);
});

/** The lines of the shell blocks that contain `needle`. */
function commandsOf(needle: string): string {
  return commands
    .split('\n')
    .filter((line) => line.includes(needle))
    .join('\n');
}

test('the base backup is streamed through the container as the administrator and the last segment is forced out', () => {
  expect(commands).toContain('pg_basebackup -U postgres -D - -Ft -X none --checkpoint=fast | gzip > base.tar.gz');
  expect(commands).toContain("psql -U postgres -c 'select pg_switch_wal()'");
});

test('what the check commands look for exists in the migrations: the tables, the history and the trigger', () => {
  const migrations = readText(path.join(ROOT, 'migrations/001_initial.sql'));
  expect(migrations).toContain('create trigger cla_versions_immutable');
  expect(migrations).toContain('create table signatures');
  expect(backup).toContain('cla_versions_immutable');
  expect(commands).toContain('select count(*) from schema_migrations');
  expect(readText(path.join(ROOT, 'src/server/adapters/db/migrator.ts'))).toContain('schema_migrations');
});

test('it covers the three things to save, personal data in the dump, and the restore of erased data', () => {
  const [what] = sectionsOf(backup, 2).filter((section) => section.heading === 'What to back up');
  expect(what?.body).toContain('`secrets/` and `.env`');
  expect(what?.body).toContain('`caddy-data`');
  expect(what?.body).toMatch(/Encrypt it/);
  const [after] = sectionsOf(backup, 3).filter((section) => section.heading === 'After the restore');
  expect(after?.body).toContain('data-protection.md#after-a-restore');
});

test('the provisioning script for a server of your own takes the password files named on the page and says unchanged', () => {
  const script = readText(path.join(ROOT, 'scripts/provision-database.sh'));
  for (const variable of ['CLA_OWNER_PASSWORD', 'CLA_APP_PASSWORD', 'PGPASSWORD', 'PGPASSFILE', 'PGSERVICE']) {
    expect(script, variable).toContain(variable);
  }
  expect(commands).toContain(
    'CLA_OWNER_PASSWORD_FILE=secrets/db_owner_password CLA_APP_PASSWORD_FILE=secrets/db_app_password sh scripts/provision-database.sh',
  );
  expect(script).toContain('`unchanged`');
});
