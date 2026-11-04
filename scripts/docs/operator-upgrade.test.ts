// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { readText } from '../ci/lib/test-support.ts';
import { readCompose, serviceNamed, withDefault } from '../compose/test-support.ts';
import { codeBlocks, guide, inOrder, placeholder, ROOT, sectionsOf, serverSource, tablesOf } from './test-support.ts';

// docs/operations/upgrade.md against the migrator and the stack (E19-S09): the order of the steps, the refusals of `migrate`
// with the messages the code prints, and the claims about what compose starts first.

const upgrade = guide('upgrade');
const commands = codeBlocks(upgrade, 'sh')
  .map((block) => block.text)
  .join('\n');
const compose = readCompose();

test('the steps are, in order: read what changed, back up, check out, rebuild, watch migrate, check the result', () => {
  const [steps] = sectionsOf(upgrade, 2).filter((section) => section.heading === 'Steps');
  expect(steps?.body.match(/^\d\. /gm)).toHaveLength(6);
  expect(
    inOrder(steps?.body ?? '', [
      '1. Read what changed',
      '2. Take a backup',
      '3. Check out',
      '4. Rebuild',
      '5. Watch',
      '6. Check the result',
    ]),
  ).toBe(true);
  expect(
    inOrder(commands, [
      'git fetch --tags',
      'git checkout v1.2.0',
      'sh scripts/init-secrets.sh',
      'up --build -d',
      'logs migrate',
      'readyz',
    ]),
  ).toBe(true);
});

test('the rebuild is the install command with --build, and compose runs migrate to completion before it re-creates app', () => {
  expect(commands).toContain('SOURCE_COMMIT=$(git rev-parse HEAD) docker compose --profile tls up --build -d');
  expect(serviceNamed(compose, 'app').depends_on?.['migrate']?.condition).toBe('service_completed_successfully');
  expect(serviceNamed(compose, 'migrate').restart).toBe('no');
  expect(upgrade).toMatch(/runs `migrate` to completion, and only then re-creates `app`/);
});

test('releases are tags named v<version>, which is what the pipeline treats as a release', () => {
  expect(readText(path.join(ROOT, '.github/workflows/ci.yml'))).toContain('tags: ["v*"]');
  expect(upgrade).toContain('tags named `v<version>`');
});

test('the checks after the upgrade read what the server answers: ready, and the commit of the checkout', () => {
  const source = serverSource();
  expect(source).toContain("status: 'ready'");
  expect(source).toContain("status: 'unavailable'");
  expect(source).toContain('commitSchema');
  expect(upgrade).toContain('{"status":"ready"}');
  expect(upgrade).toMatch(/the `commit` of `\/api\/meta` is `git rev-parse HEAD`/);
});

test('the success lines of migrate are the ones it prints', () => {
  const source = readText(path.join(ROOT, 'src/server/adapters/db/migrate-cli.ts'));
  for (const line of [
    'migrations applied:',
    'migrations: up to date',
    'job queues: up to date',
    'job queues created',
    'job queues updated',
  ]) {
    expect(source, line).toContain(line);
  }
  for (const line of [
    'migrations applied: <names>',
    'migrations: up to date',
    'job queues: up to date',
    'job queues created',
  ]) {
    expect(upgrade, line).toContain(line);
  }
  expect(source).toContain('migration failed: ');
  expect(upgrade).toContain('`migration failed:`');
});

const [refusals] = tablesOf(
  sectionsOf(upgrade, 2).find((section) => section.heading === 'When `migrate` refuses')?.body ?? '',
);
const messages = (refusals?.rows ?? []).map((cells) => cells[0] ?? '');

test('each refusal in the table is a message the code can print, with the placeholders where the code puts names', () => {
  const migrator = readText(path.join(ROOT, 'src/server/adapters/db/migrator.ts'));
  const files = readText(path.join(ROOT, 'src/server/adapters/db/migration-files.ts'));
  const policy = readText(path.join(ROOT, 'src/server/adapters/jobs/queue-policy.ts'));
  expect(messages).toHaveLength(7);
  expect(messages[0]).toContain('applied migration <name> was edited after it was applied (checksum mismatch)');
  expect(migrator).toContain(
    `applied migration ${placeholder('row.name')} was edited after it was applied (checksum mismatch)`,
  );
  expect(messages[1]).toContain('applied migration <name> is missing from the migrations directory');
  expect(migrator).toContain(`applied migration ${placeholder('row.name')} is missing from the migrations directory`);
  expect(messages[2]).toContain('pending migration <name> is older than the applied migration <newest>');
  expect(migrator).toContain(
    `pending migration ${placeholder('stale.name')} is older than the applied migration ${placeholder('newest')}`,
  );
  expect(messages[3]).toContain('invalid migration file name');
  expect(files).toContain('invalid migration file name');
  expect(messages[3]).toContain('two migrations share the number');
  expect(files).toContain('two migrations share the number');
  expect(files).toContain('NNN_snake_case.sql');
  expect(messages[6]).toContain('Job queues have the wrong policy');
  expect(policy).toContain('Job queues have the wrong policy');
});

test('the refusals about the history name the three ways it can disagree with the files, and nothing edits schema_migrations', () => {
  const [history] = sectionsOf(upgrade, 2).filter(
    (section) => section.heading === 'Migrations are forward-only and checksummed',
  );
  expect(history?.body).toMatch(
    /an applied migration that was edited, or is missing, or a new one that sorts before one already applied/,
  );
  expect(history?.body).toMatch(/There are no down migrations/);
  expect(readText(path.join(ROOT, 'migrations/001_initial.sql'))).toContain('schema_migrations');
  expect(upgrade).toMatch(/do not edit `schema_migrations` by hand/);
});

test('the runtime role is granted only if it exists when a migration runs, which is why a database migrated before it needs a restore', () => {
  const grants = readText(path.join(ROOT, 'migrations/001_initial.sql'));
  expect(grants).toContain("where rolname = 'cla_app'");
  expect(grants).toContain('runtime grants skipped');
  expect(upgrade).toContain('`permission denied for table <name>`');
});

test('the downgrade is a restore into a freshly provisioned database: it removes the volume the compose file names', () => {
  expect(commands).toContain(`docker volume rm ${compose.name}_cla-postgres-data`);
  expect(commands).toContain('git checkout v1.1.0');
  expect(commands).toContain(
    'docker compose exec -T postgres pg_restore -U postgres -d cla --no-owner --role=cla_owner --clean --if-exists --exit-on-error < cla.dump',
  );
  expect(
    inOrder(commands, [
      'git checkout v1.1.0',
      'down',
      'docker volume rm',
      'up -d --wait postgres',
      'pg_restore',
      'up --build -d',
    ]),
  ).toBe(true);
});

test('the PostgreSQL major version is pinned by the tag of the image, and the sweep default is the 30 minutes the page quotes', () => {
  expect(serviceNamed(compose, 'postgres').image).toBe('postgres:18');
  expect(serviceNamed(compose, 'app').environment?.['SWEEP_INTERVAL_MINUTES']).toBe(
    withDefault('SWEEP_INTERVAL_MINUTES', '30'),
  );
  expect(upgrade).toContain('the periodic sweep (every 30 minutes by default)');
  expect(upgrade).toContain('The PostgreSQL major version is pinned by the image tag in `docker-compose.yml`');
});

test('the stack documents the tracked files an upgrade must not change, and the untracked ones it keeps', () => {
  const ignored = readText(path.join(ROOT, '.gitignore'));
  expect(ignored).toMatch(/^secrets\/$/m);
  expect(ignored).toMatch(/^\.env$/m);
  expect(upgrade).toContain('`.env`, `secrets/`, an override file');
});
