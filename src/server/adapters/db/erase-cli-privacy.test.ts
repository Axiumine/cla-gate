// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import process from 'node:process';
import { expect, test, vi } from 'vitest';
import {
  BYSTANDER,
  callFor,
  erasureAudit,
  erasureWorld,
  failStatement,
  othersOf,
  rowsOf,
  TARGET,
} from '../../services/operator-erasure-fixture/test-support.ts';
import { closable } from './cli-fixture/test-support.ts';
import { runEraseCli } from './erase-cli.ts';
import { columnsHolding } from './erasure-fixture/test-support.ts';

// The privacy of the operator's erasure command (E22-S05): what it prints holds counts and numeric ids and nothing a signer typed,
// the audit rows it causes hold no name, email or login, and erasing a person leaves the rows of other people as they were.

const ENV = { DATABASE_URL: 'postgres://cla_app@db.internal:5432/cla' };
const ARGS = ['--github-id', '4242', '--actor-github-id', '9001'];

/** The names a signer can type into the signing form that are hostile to whatever shows them later: a spreadsheet formula and SQL. */
const HOSTILE = ["=cmd|' /C calc'!A0", "Robert'); DROP TABLE users;--"] as const;

/** The channels a line could leave by: the two sinks of the command, the process streams and the console. */
function listening() {
  const lines: string[] = [];
  const keep = (chunk: unknown): boolean => {
    lines.push(String(chunk));
    return true;
  };
  vi.spyOn(process.stdout, 'write').mockImplementation(keep);
  vi.spyOn(process.stderr, 'write').mockImplementation(keep);
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    });
  }
  return lines;
}

test.each(HOSTILE)(
  'the name %s, stored as the name, the login and the email of a signer, never appears in stdout, stderr or a log line',
  async (hostile) => {
    const lines = listening();
    const world = await erasureWorld({ name: hostile, email: `${hostile}@example.test`, login: hostile });
    const { handle } = closable(world.db);
    const connect = () => handle;
    const sinks = { out: (line: string) => lines.push(line), err: (line: string) => lines.push(line) };
    expect(await columnsHolding(world.db, [hostile])).toEqual([
      'signer_pii.email',
      'signer_pii.login',
      'signer_pii.name',
      'users.login',
    ]);
    expect(await runEraseCli({ argv: ARGS, env: ENV, connect, ...sinks })).toBe(0);
    expect(await runEraseCli({ argv: [...ARGS, '--execute'], env: ENV, connect, ...sinks })).toBe(0);
    expect(await runEraseCli({ argv: [...ARGS, '--execute'], env: ENV, connect, ...sinks })).toBe(0);
    expect(
      await runEraseCli({ argv: ['--github-id', hostile, '--actor-github-id', '1'], env: ENV, connect, ...sinks }),
    ).toBe(2);
    expect(lines.length).toBeGreaterThan(5);
    expect(lines.join('\n')).not.toContain(hostile);
    expect(lines.join('\n')).not.toContain('example.test');
    expect(await columnsHolding(world.db, [hostile])).toEqual([]);
  },
);

test('a failure part-way and an unknown person print no name, login or email either', async () => {
  const lines = listening();
  const world = await erasureWorld({ name: HOSTILE[0], email: 'zzzz@example.test', login: HOSTILE[1] });
  const sinks = { out: (line: string) => lines.push(line), err: (line: string) => lines.push(line) };
  const failing = world.db.withPlugin(failStatement(callFor(world.t2.installationId), 1, new Error(HOSTILE[0])));
  expect(
    await runEraseCli({ argv: [...ARGS, '--execute'], env: ENV, connect: () => closable(failing).handle, ...sinks }),
  ).toBe(4);
  expect(
    await runEraseCli({
      argv: ['--github-id', '1', '--actor-github-id', '1'],
      env: ENV,
      connect: () => closable(world.db).handle,
      ...sinks,
    }),
  ).toBe(1);
  expect(lines.join('\n')).not.toMatch(/zzzz|calc|DROP TABLE/);
  expect(lines).toEqual([
    'erase failed: Error',
    `installations done: ${world.t1.installationId}; pending: ${world.t2.installationId}; running the command again is safe`,
    'no such user',
  ]);
});

test('the audit rows the command causes name the installation, the operator and the person by number, and hold no name, email or login', async () => {
  const data = { name: 'Zzzz Unique Name', email: 'zzzz.unique@mail.test', login: 'zzzz-unique-login' };
  const world = await erasureWorld(data);
  const { handle } = closable(world.db);
  const sinks = { out: () => undefined, err: () => undefined };
  expect(await runEraseCli({ argv: [...ARGS, '--execute'], env: ENV, connect: () => handle, ...sinks })).toBe(0);
  const audit = await erasureAudit(world.db);
  expect(audit).toEqual([
    {
      installation_id: world.t1.installationId,
      actor_github_id: 9001,
      action: 'signer_pii.erased',
      subject_type: 'user',
      subject_id: TARGET,
      metadata: { signer_pii_rows: 1 },
    },
    {
      installation_id: world.t2.installationId,
      actor_github_id: 9001,
      action: 'signer_pii.erased',
      subject_type: 'user',
      subject_id: TARGET,
      metadata: { signer_pii_rows: 1 },
    },
  ]);
  const everything = JSON.stringify(await world.db.selectFrom('audit_log').selectAll().execute());
  for (const personal of [...Object.values(data), 'Name 4242', 'u4242@example.test', 'login-4242']) {
    expect(everything).not.toContain(personal);
  }
});

test('erasing a person leaves the rows of other people in the same tenants, and of the tenant they never signed in, as they were', async () => {
  const world = await erasureWorld();
  const { handle } = closable(world.db);
  const before = await othersOf(world.db, TARGET);
  const sinks = { out: () => undefined, err: () => undefined };
  expect(await runEraseCli({ argv: [...ARGS, '--execute'], env: ENV, connect: () => handle, ...sinks })).toBe(0);
  expect(await othersOf(world.db, TARGET)).toEqual(before);
  expect(await rowsOf(world.db, BYSTANDER)).toHaveLength(2);
  expect((await erasureAudit(world.db)).map((row) => row.installation_id)).not.toContain(world.t3.installationId);
});

test('erasing one person writes no audit row about anyone else', async () => {
  const world = await erasureWorld();
  const { handle } = closable(world.db);
  const sinks = { out: () => undefined, err: () => undefined };
  await runEraseCli({ argv: [...ARGS, '--execute'], env: ENV, connect: () => handle, ...sinks });
  const subjects = await world.db.selectFrom('audit_log').select('subject_id').execute();
  expect(subjects.map((row) => row.subject_id)).toEqual([TARGET, TARGET]);
});
