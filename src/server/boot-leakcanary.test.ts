// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import { openPgliteDatabase } from './adapters/db/pglite.ts';
import { boot } from './boot.ts';
import { SECRET_VARIABLES } from './config/secret-files.ts';
import { secretDirectory } from './config/secret-fixture/test-support.ts';
import { captureLogs, FakeProcess, freePort, startFakeJobQueue, UNREACHABLE_DATABASE_URL } from './test-support.ts';

// E19-S02, the hostile test at the process level: a secret that is `LEAKCANARY-<name>`, given as the variable or as a file,
// either stops the start or starts the server, and in both cases the canary is on no line of stdout, stderr or the log.

const CANARY = 'LEAKCANARY';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Boots with `env`, collecting everything the process says; returns all of it as one text. */
async function everythingSaid(env: Record<string, string>): Promise<string> {
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  const logs = captureLogs();
  const errors: string[] = [];
  const server = await boot({
    // The environment is the base of every test below; `LOG_LEVEL=trace` makes the log say as much as it ever does.
    env: {
      DATABASE_URL: UNREACHABLE_DATABASE_URL,
      HOST: '127.0.0.1',
      PORT: String(await freePort()),
      LOG_LEVEL: 'trace',
      ...env,
    },
    signals: new FakeProcess(),
    createDb: () => openPgliteDatabase(),
    createJobQueue: startFakeJobQueue,
    logDestination: logs.destination,
    err: (line) => errors.push(line),
    reconcileOnStart: false,
  });
  onTestFinished(async () => {
    await server?.close();
  });
  if (server !== undefined) {
    await fetch(`${server.address}/readyz`);
    await server.close();
  }
  return [...errors, logs.text(), ...stdout.mock.calls.map(String), ...stderr.mock.calls.map(String)].join('\n');
}

test.each(SECRET_VARIABLES.filter((name) => name !== 'MIGRATION_DATABASE_URL'))(
  'LEAKCANARY as %s, as the variable, is on no line of the log, stdout or stderr',
  async (name) => {
    expect(await everythingSaid({ [name]: `${CANARY}-${name}` })).not.toContain(CANARY);
  },
);

test.each(SECRET_VARIABLES.filter((name) => name !== 'MIGRATION_DATABASE_URL'))(
  'LEAKCANARY as the file of %s is on no line of the log, stdout or stderr',
  async (name) => {
    const files = secretDirectory();
    const file = files.write(name.toLowerCase(), `${CANARY}-${name}\n`);
    expect(await everythingSaid({ [`${name}_FILE`]: file })).not.toContain(CANARY);
  },
);

test('the same value in the variable and in its file is refused by name, and the value is on no line', async () => {
  const files = secretDirectory();
  const said = await everythingSaid({
    SESSION_SECRET: `${CANARY}-SESSION_SECRET`,
    SESSION_SECRET_FILE: files.write('session', `${CANARY}-SESSION_SECRET`),
  });
  expect(said).toContain('SESSION_SECRET, SESSION_SECRET_FILE: set only one');
  expect(said).not.toContain(CANARY);
});
