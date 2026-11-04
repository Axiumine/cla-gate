// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from 'vitest';
import { z } from 'zod';
import {
  ALLOW_APP_DATABASE,
  appDatabaseRefusal,
} from '../../src/server/adapters/db/test-database-guard/test-support.ts';
import { runPostgresCli } from '../ci/lib/postgres-cli.ts';
import type { CliDeps } from '../ci/lib/postgres-deps.ts';
import { collectIo, exists, fakeDocker, findOnPath, ok, readText } from '../ci/lib/test-support.ts';
import { tempDir } from '../code-caps/test-support.ts';
import { runDevDbCli } from '../dev/lib/dev-db-cli.ts';
import { writePort } from '../dev/lib/dev-db-state.ts';
import { codeBlocks, headingsOf, linksOf, placeholder, proseOf, ROOT, sectionsOf } from './test-support.ts';

// docs/development/test-database.md against the code (E19-S10): the guard, the variables, the test role, the skip reasons and
// the commands it tells a developer to run are the ones the repository has. The links and tables of the page are checked with
// those of every other document (markdown.test.ts).

const packageSchema = z.object({ scripts: z.record(z.string(), z.string()) });
const PAGE = path.join(ROOT, 'docs/development/test-database.md');
const page = readText(PAGE);
const prose = proseOf(page);
const source = (file: string): string => readText(path.join(ROOT, file));
const commands = codeBlocks(page, 'sh');
const everyCommand = commands.map((block) => block.text).join('\n');

test('the page exists and opens with one level-one title', () => {
  const titles = prose.split('\n').filter((line) => line.startsWith('# '));
  expect(titles).toEqual(['# Running the tests against a PostgreSQL server']);
  expect(page.startsWith(titles[0] ?? '?')).toBe(true);
});

test('the sections are the ones the story asks for, in order', () => {
  expect(sectionsOf(page, 2).map((section) => section.heading)).toEqual([
    'What a run does to the server',
    'Use a server that holds nothing you need',
    'The test role',
    'Real-Postgres-only suites',
    'The CI way',
  ]);
});

test('the throw-away database and the guard it describes are the ones the global setup makes and enforces', () => {
  const setup = source('src/server/adapters/db/global-setup.ts');
  expect(prose).toContain('`cla_test_<random>` (twelve hex characters)');
  expect(setup).toContain(`\`cla_test_${placeholder("randomBytes(6).toString('hex')")}\``);
  expect(prose).toContain(`\`${ALLOW_APP_DATABASE}=1\``);
  expect(prose).toContain('only the value `1` counts');
  const quoted = /begins `([^`]+)`/.exec(prose)?.[1] ?? '';
  expect(appDatabaseRefusal('<name>').startsWith(quoted)).toBe(true);
  expect(quoted).toContain('schema_migrations');
  expect(exists(path.join(ROOT, 'src/server/adapters/db/global-setup.test.ts'))).toBe(true);
  expect(prose).toContain('`src/server/adapters/db/global-setup.test.ts`');
});

test('it warns against a production DATABASE_URL in the shell that runs yarn test or yarn dev, and says why', () => {
  expect(prose).toContain(
    'Do not export a production `DATABASE_URL` in a shell that also runs `yarn test` or `yarn dev`.',
  );
  expect(prose).toContain('`yarn db:migrate`');
  expect(prose).toContain('`MIGRATION_DATABASE_URL`');
  expect(prose).toContain('Never use a server that holds real signatures.');
});

test('the test role is the one the provisioning script creates, and the inputs it names are the inputs the script reads', () => {
  const sql = source('scripts/provision-database.sql');
  expect(sql).toContain(
    "create role %I login createdb createrole nosuperuser noreplication nobypassrls', :'test_role'",
  );
  expect(sql).toContain("revoke all on database %I from %I', :'db', :'test_role'");
  expect(sql).toContain('CLA_TEST_ROLE is a development-only role and is refused when NODE_ENV=production');
  for (const name of ['CLA_TEST_ROLE', 'CLA_TEST_PASSWORD', 'CLA_TEST_PASSWORD_FILE']) {
    expect(prose + everyCommand).toContain(name);
  }
  expect(source('scripts/provision-database.sh')).toContain('resolve CLA_TEST_PASSWORD');
  expect(sql).toContain('the test role belongs to neither');
  expect(sql).toContain("format('revoke %I from %I granted by %I'");
  expect(prose).toContain('belongs to neither application role');
  expect(prose).toContain('has no `CONNECT` on the application database `cla`');
  expect(prose).toContain('the URL names the maintenance database `postgres`');
  expect(everyCommand).toContain('/postgres" yarn test');
});

test('the grant that the test role needs is the same statement in the SQL block and in both paths, and without it the tests cannot switch role', () => {
  const statement = 'grant cla_app to cla_test with inherit false, set true';
  expect(codeBlocks(page, 'sql').map((block) => block.text)).toContain(`${statement};`);
  expect(commands.filter((block) => block.text.includes(`-c '${statement}'`))).toHaveLength(2);
  expect(source('src/server/adapters/db/test-support.ts')).toContain('set local role cla_app');
  expect(prose).toContain('permission denied to set role "cla_app"');
});

test('the dev database commands name the container, the script and the user that docker-compose.dev.yml has', () => {
  const dev = source('docker-compose.dev.yml');
  const project = /^name: (\S+)$/m.exec(dev)?.[1];
  expect(project).toBe('cla-gate-dev');
  expect(dev).toMatch(/^ {2}postgres:$/m);
  expect(dev).toContain('./scripts/provision-database.sh:/docker-entrypoint-initdb.d/10-provision-database.sh:ro');
  expect(everyCommand).toContain(`${project}-postgres-1 sh /docker-entrypoint-initdb.d/10-provision-database.sh`);
  expect(everyCommand).toContain('-e PGUSER=postgres');
});

test('the gates and the skip reasons are the ones the tests use', () => {
  const support = source('src/server/adapters/db/test-support.ts');
  for (const reason of ['needs real Postgres', 'needs CLA_ROLE_TESTS=1']) {
    expect(support).toContain(`'${reason}'`);
    expect(prose).toContain(`\`${reason}\``);
  }
  for (const name of ['realPostgresOnly', 'realPostgresRolesOnly', 'REQUIRE_REAL_POSTGRES', 'CLA_ROLE_TESTS']) {
    expect(support).toContain(name);
    expect(prose + everyCommand).toContain(name);
  }
  expect(source('src/server/adapters/db/provision-database.test.ts')).toContain("process.env['CLA_PG_CONTAINER']");
  expect(prose).toContain('`CLA_PG_CONTAINER`');
});

test('every yarn command it names is a script of package.json', () => {
  const scripts = Object.keys(packageSchema.parse(JSON.parse(source('package.json'))).scripts);
  const named = (prose + everyCommand).match(/\byarn [a-z:]+/g)?.map((command) => command.slice('yarn '.length)) ?? [];
  expect(new Set(named)).toEqual(new Set(['test', 'dev', 'db:up', 'db:url', 'db:migrate', 'ci:postgres']));
  expect(named.filter((name) => !scripts.includes(name))).toEqual([]);
});

test('it points at yarn db:up and the disposable container, and names no fixed port', () => {
  expect(page).toContain('`yarn db:up`');
  expect(page).toContain('`scripts/ci/postgres.ts`');
  expect(exists(path.join(ROOT, 'scripts/ci/postgres.ts'))).toBe(true);
  expect(page).not.toMatch(/\b(?:5432|3000|5173)\b/);
  expect(page).toContain('a random free loopback port above 32768');
});

/** What `yarn ci:postgres start` prints outside Actions, from the real command with a scripted docker. */
async function printedByStart(): Promise<string> {
  const docker = fakeDocker([['inspect', [ok('running healthy')]]]);
  const deps: CliDeps = {
    exec: docker.exec,
    pickPort: () => Promise.resolve(41_000),
    sleep: () => Promise.resolve(),
    now: () => 0,
    randomHex: (bytes) => (bytes === 24 ? 'f'.repeat(48) : 'beef0001'),
    appendFile: () => undefined,
  };
  const { io, out } = collectIo();
  expect(await runPostgresCli(['start'], {}, io, deps)).toBe(0);
  return `${out.join('\n')}\n`;
}

/** The `sed` scripts of the page, in order: each is the text between the quotes after `sed -n`. */
const sedScripts = [...everyCommand.matchAll(/sed -n '([^']+)'/g)].map((match) => match[1] ?? '');

/** What `sed -n <script>` prints for `input`. */
function sedPrints(script: string, input: string): string[] {
  const result = spawnSync(findOnPath('sed'), ['-n', script], { input, encoding: 'utf8' });
  expect(result.status).toBe(0);
  return result.stdout.split('\n').slice(0, -1);
}

test('the sed expression of the CI way exports exactly the two variables that the helper prints and nothing else', async () => {
  expect(sedScripts).toHaveLength(2);
  expect(sedPrints(sedScripts[1] ?? '', await printedByStart())).toEqual([
    'export CLA_PG_CONTAINER=cla-pg-local-beef0001',
    `export DATABASE_URL=postgres://postgres:${'f'.repeat(48)}@127.0.0.1:41000/postgres`,
  ]);
});

test('the sed expression of the dev database path reads the port from what yarn db:url prints', async () => {
  const root = tempDir();
  writePort(root, 41_000);
  const { io, out } = collectIo();
  const deps = {
    exec: () => Promise.reject(new Error('no docker here')),
    pickPort: () => Promise.resolve(41_000),
    run: () => Promise.resolve(0),
  };
  expect(await runDevDbCli(['url'], { root, env: {}, deps, io })).toBe(0);
  expect(sedPrints(sedScripts[0] ?? '', `${out.join('\n')}\n`)).toEqual(['41000']);
});

test('every shell block is valid shell, and the page has two SQL blocks: the two statements for the leftovers and the grant', () => {
  const broken = commands
    .filter((block) => spawnSync(findOnPath('sh'), ['-n'], { input: block.text }).status !== 0)
    .map((block) => block.text.split('\n')[0]);
  expect(broken).toEqual([]);
  expect(commands).toHaveLength(4);
  expect(codeBlocks(page, 'sql').map((block) => block.text.split('\n').length)).toEqual([2, 1]);
});

test('it links to the pages it depends on, and mentions no emoji and no word the project avoids', () => {
  const targets = linksOf(page).map((target) => target.split('#')[0]);
  expect(targets).toEqual(
    expect.arrayContaining(['../development.md', '../operations/install.md', '../ci-runners.md']),
  );
  expect(headingsOf(page)).not.toHaveLength(0);
  expect(page).not.toMatch(/\p{Extended_Pictographic}/u);
  expect(page.toLowerCase()).not.toContain('multi-installation');
});
