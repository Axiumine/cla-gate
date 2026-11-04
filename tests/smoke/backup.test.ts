// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { listNames } from '../../scripts/smoke/files.ts';
import { OPERATOR_COMMANDS as COMMANDS } from '../../scripts/smoke/operator-commands.ts';
import { output, sqlAs } from '../../scripts/smoke/probe.ts';
import { clock } from '../../scripts/smoke/system.ts';
import { eventually } from '../../scripts/smoke/wait.ts';
import { ownStack } from './scenario.ts';
import { getFrom } from './support.ts';

// E19-S12, backup and restore rehearsal: the commands of docs/operations/backup-restore.md, run as that guide prints them
// (`Stack.shell`; operator-commands.test.ts keeps the two equal). The database gets a CLA version, it is dumped, the stack is
// removed with its volumes, started again on an empty volume (the provisioning script makes the roles again), restored, and the
// stack is started on top of it.

const stack = ownStack({ scenario: 'backup' });
const MIGRATIONS = path.resolve(import.meta.dirname, '../../migrations');
const READY_MS = 120_000;
/** A document with one published version, made as the owner role would: the row the immutability trigger must still protect. */
const SEED = `
  with u as (insert into users (github_id, login) values (4242, 'smoke-user') returning id),
  i as (insert into installations (github_installation_id, account_id, account_login, account_type)
        values (4242, 4242, 'smoke-org', 'Organization') returning id),
  d as (insert into cla_documents (installation_id, name, kind) select id, 'Smoke CLA', 'individual' from i returning id)
  insert into cla_versions (document_id, major, minor, content_md, content_sha256, published_by, rationale)
  select d.id, 1, 0, 'The smoke agreement.', encode(sha256(convert_to('The smoke agreement.', 'UTF8')), 'hex'), u.id, 'restore rehearsal'
  from d, u`;
const HISTORY = "select name || ' ' || checksum || ' ' || applied_at::text from schema_migrations order by name";
let history = '';

/** Runs a statement as `cla_owner` and returns its output; a failure is the error of the test. */
async function owner(statement: string): Promise<string> {
  const result = await sqlAs(stack(), 'cla_owner', statement);
  expect(result.code, output(result)).toBe(0);
  return result.stdout.trim();
}

/** Runs the lines of the guide in the stack's work directory; a failure is the error of the test. */
async function operate(line: string): Promise<string> {
  const result = await stack().shell(line);
  expect(result.code, `${line}\n${output(result)}`).toBe(0);
  return result.stdout.trim();
}

test('the database holds a CLA version, and the history of its migrations is recorded', async () => {
  await owner(SEED);
  expect(await owner('select rationale from cla_versions')).toBe('restore rehearsal');
  history = await owner(HISTORY);
  const files = listNames(MIGRATIONS).filter((name) => name.endsWith('.sql'));
  expect(history.split('\n')).toHaveLength(files.length);
});

test('pg_dump -Fc through docker compose exec -T writes a dump that is not empty', async () => {
  await operate(COMMANDS.dump);
  await operate('test -s cla.dump');
});

test('down -v removes the stack and its database volume', async () => {
  await operate(COMMANDS.removeStack);
  const volumes = await stack().docker([
    'volume',
    'ls',
    '--quiet',
    '--filter',
    `label=com.docker.compose.project=${stack().names.project}`,
  ]);
  expect([volumes.code, volumes.stdout.trim()]).toEqual([0, '']);
});

test('up on the empty volume provisions the roles again, and the database is empty', async () => {
  await operate(COMMANDS.startDatabase);
  expect(
    await owner("select string_agg(rolname, ' ' order by rolname) from pg_roles where rolname like 'cla\\_%'"),
  ).toBe('cla_app cla_owner');
  expect(await owner("select count(*) from pg_tables where schemaname = 'public'")).toBe('0');
});

test('pg_restore --no-owner --role=cla_owner restores the dump', async () => {
  await operate(COMMANDS.restore);
  expect(await owner('select count(*) from cla_versions')).toBe('1');
});

test('up starts migrate and the application on top of the restored database, and /readyz is 200', async () => {
  await operate(COMMANDS.startStack);
  const ready = await eventually(clock, '/readyz to answer 200', READY_MS, async () => {
    const response = await getFrom(stack(), '/readyz');
    return response.status === 200 ? response : undefined;
  });
  expect(await ready.json()).toEqual({ status: 'ready' });
});

test('schema_migrations is unchanged, and migrate found nothing to apply', async () => {
  expect(await owner(HISTORY)).toBe(history);
  expect(await operate(COMMANDS.countMigrations)).toBe(String(history.split('\n').length));
  const logs = await stack().compose(['logs', '--no-color', 'migrate']);
  expect(logs.code, output(logs)).toBe(0);
  expect(logs.stdout).toContain('migrations: up to date');
  expect(logs.stdout).not.toContain('migrations applied');
});

test('the immutability triggers came back with the dump and still reject an update of cla_versions', async () => {
  expect(await operate(COMMANDS.versionTriggers)).toContain('cla_versions_immutable');
  const update = await sqlAs(stack(), 'cla_owner', "update cla_versions set rationale = 'changed'");
  expect(update.code).not.toBe(0);
  expect(output(update)).toMatch(/23001.*cla_versions is immutable/);
  expect(await owner('select rationale from cla_versions')).toBe('restore rehearsal');
});

test('the grants came back too: the runtime role still cannot change a CLA version', async () => {
  const update = await sqlAs(stack(), 'cla_app', 'update cla_versions set rationale = rationale');
  expect(update.code).not.toBe(0);
  expect(output(update)).toMatch(/42501.*permission denied/);
  const read = await sqlAs(stack(), 'cla_app', 'select count(*) from cla_versions');
  expect([read.code, read.stdout.trim()]).toEqual([0, '1']);
});
