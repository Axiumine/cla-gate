// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import process from 'node:process';
import { expect, test, vi } from 'vitest';
import {
  DATABASE_KIND,
  engineOf,
  type Gate,
  type GateHost,
  NEEDS_REAL_POSTGRES,
  NEEDS_ROLE_TESTS,
  realPostgres,
  realPostgresGate,
  realPostgresOnly,
  realPostgresRolesGate,
  realPostgresRolesOnly,
  runGated,
} from './test-support.ts';

// E20-S03: what a real-Postgres-only test does on PGlite and on a real server, in every combination of the two flags.

const MISSING = 'REQUIRE_REAL_POSTGRES=1 but this run uses PGlite: set DATABASE_URL to a real Postgres server';
const RUN: Gate = { action: 'run' };
const SKIP_PG: Gate = { action: 'skip', note: 'needs real Postgres' };
const SKIP_ROLES: Gate = { action: 'skip', note: 'needs CLA_ROLE_TESTS=1' };
const FAIL: Gate = { action: 'fail', message: MISSING };

test.each([
  ['PGlite without flags', 'pglite', {}, SKIP_PG],
  ['PGlite with REQUIRE_REAL_POSTGRES=1', 'pglite', { REQUIRE_REAL_POSTGRES: '1' }, FAIL],
  ['PGlite with REQUIRE_REAL_POSTGRES=0', 'pglite', { REQUIRE_REAL_POSTGRES: '0' }, SKIP_PG],
  ['PGlite with REQUIRE_REAL_POSTGRES=true (only 1 counts)', 'pglite', { REQUIRE_REAL_POSTGRES: 'true' }, SKIP_PG],
  ['PGlite with REQUIRE_REAL_POSTGRES set to nothing', 'pglite', { REQUIRE_REAL_POSTGRES: undefined }, SKIP_PG],
  ['a real server without flags', 'postgres', {}, RUN],
  ['a real server with REQUIRE_REAL_POSTGRES=1', 'postgres', { REQUIRE_REAL_POSTGRES: '1' }, RUN],
] as const)('realPostgresOnly on %s', (_name, kind, env, expected) => {
  expect(realPostgresGate(kind, env)).toEqual(expected);
});

test.each([
  ['PGlite without flags', 'pglite', {}, SKIP_PG],
  ['PGlite with CLA_ROLE_TESTS=1 (roles need a real server first)', 'pglite', { CLA_ROLE_TESTS: '1' }, SKIP_PG],
  ['PGlite with both flags', 'pglite', { REQUIRE_REAL_POSTGRES: '1', CLA_ROLE_TESTS: '1' }, FAIL],
  ['a real server without flags', 'postgres', {}, SKIP_ROLES],
  ['a real server with CLA_ROLE_TESTS=0', 'postgres', { CLA_ROLE_TESTS: '0' }, SKIP_ROLES],
  ['a real server with only REQUIRE_REAL_POSTGRES=1', 'postgres', { REQUIRE_REAL_POSTGRES: '1' }, SKIP_ROLES],
  ['a real server with CLA_ROLE_TESTS=1', 'postgres', { CLA_ROLE_TESTS: '1' }, RUN],
] as const)('realPostgresRolesOnly on %s', (_name, kind, env, expected) => {
  expect(realPostgresRolesGate(kind, env)).toEqual(expected);
});

class SkipSignal extends Error {}

function skipByThrowing(note: string): never {
  throw new SkipSignal(note);
}

test('a skip gate skips with its reason and never runs the body', async () => {
  const calls: string[] = [];
  const attempt = runGated(SKIP_PG, skipByThrowing, () => {
    calls.push('body');
    return Promise.resolve();
  });
  await expect(attempt).rejects.toThrow(new SkipSignal(NEEDS_REAL_POSTGRES));
  expect(calls).toEqual([]);
});

test('a fail gate fails the test with its message and never skips or runs the body', async () => {
  const calls: string[] = [];
  const attempt = runGated(FAIL, skipByThrowing, () => {
    calls.push('body');
    return Promise.resolve();
  });
  await expect(attempt).rejects.toThrow(MISSING);
  await expect(attempt).rejects.not.toBeInstanceOf(SkipSignal);
  expect(calls).toEqual([]);
});

test('a run gate runs the body once and does not skip', async () => {
  const calls: string[] = [];
  await runGated(RUN, skipByThrowing, () => {
    calls.push('body');
    return Promise.resolve();
  });
  expect(calls).toEqual(['body']);
});

type Wrapper = typeof realPostgresOnly;
type Registered = Parameters<GateHost['register']>[1];

/**
 * Wraps a body with `wrapper` on a host that only records the registered test, runs the recorded test the way Vitest
 * would (a skip is a thrown signal) with the two flags set in the real environment, and says what happened to the body.
 */
async function outcomeOf(
  wrapper: Wrapper,
  kind: GateHost['kind'],
  flags: { readonly require?: string; readonly roles?: string },
): Promise<{ names: string[]; result: string }> {
  const names: string[] = [];
  const recorded: Registered[] = [];
  const host: GateHost = {
    kind,
    register: (name, registered) => {
      names.push(name);
      recorded.push(registered);
    },
  };
  const calls: string[] = [];
  wrapper(
    'the wrapped test',
    () => {
      calls.push('body');
      return Promise.resolve();
    },
    host,
  );
  vi.stubEnv('REQUIRE_REAL_POSTGRES', flags.require);
  vi.stubEnv('CLA_ROLE_TESTS', flags.roles);
  try {
    await Promise.all(recorded.map((registered) => registered({ skip: skipByThrowing })));
    return { names, result: calls.length === 1 ? 'ran' : 'did not run' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { names, result: `${error instanceof SkipSignal ? 'skipped' : 'failed'}: ${message}` };
  } finally {
    vi.unstubAllEnvs();
  }
}

test.each([
  ['PGlite without flags', 'pglite', {}, 'skipped: needs real Postgres'],
  ['PGlite with REQUIRE_REAL_POSTGRES=1', 'pglite', { require: '1' }, `failed: ${MISSING}`],
  ['a real server without flags', 'postgres', {}, 'ran'],
  ['a real server with REQUIRE_REAL_POSTGRES=1', 'postgres', { require: '1' }, 'ran'],
  ['a real server with CLA_ROLE_TESTS unset or 0', 'postgres', { roles: '0' }, 'ran'],
] as const)(
  'the realPostgresOnly wrapper registers one test that, on %s, is %s',
  async (_name, kind, flags, expected) => {
    const { names, result } = await outcomeOf(realPostgresOnly, kind, flags);
    expect(names).toEqual(['the wrapped test']);
    expect(result).toBe(expected);
  },
);

test.each([
  ['PGlite without flags', 'pglite', {}, 'skipped: needs real Postgres'],
  ['PGlite with both flags', 'pglite', { require: '1', roles: '1' }, `failed: ${MISSING}`],
  ['a real server without flags', 'postgres', {}, 'skipped: needs CLA_ROLE_TESTS=1'],
  ['a real server with REQUIRE_REAL_POSTGRES=1 only', 'postgres', { require: '1' }, 'skipped: needs CLA_ROLE_TESTS=1'],
  ['a real server with CLA_ROLE_TESTS=1', 'postgres', { roles: '1' }, 'ran'],
] as const)(
  'the realPostgresRolesOnly wrapper registers one test that, on %s, is %s',
  async (_name, kind, flags, expected) => {
    const { names, result } = await outcomeOf(realPostgresRolesOnly, kind, flags);
    expect(names).toEqual(['the wrapped test']);
    expect(result).toBe(expected);
  },
);

test('the reasons are the ones the CI job and the docs name', () => {
  expect([NEEDS_REAL_POSTGRES, NEEDS_ROLE_TESTS]).toEqual(['needs real Postgres', 'needs CLA_ROLE_TESTS=1']);
});

test('no database URL means PGlite and any URL means a real server', () => {
  expect(engineOf(undefined)).toBe('pglite');
  expect(engineOf('postgres://user:pw@127.0.0.1:1/db')).toBe('postgres');
});

test('the engine of the run is the one the shared flag says', () => {
  expect(DATABASE_KIND).toBe(realPostgres ? 'postgres' : 'pglite');
});

test('REQUIRE_REAL_POSTGRES=1 means the suite really runs on a real server, never on PGlite', () => {
  expect(realPostgresGate(DATABASE_KIND, process.env).action).not.toBe('fail');
});

// These two are skipped on PGlite and run on the CI `postgres` job, which sets both flags: there they prove that the
// job really reaches a real server and really enables the role tests (they fail, not skip, when it does not).
realPostgresOnly('a test marked realPostgresOnly runs on a real server', () => {
  expect(realPostgres).toBe(true);
  return Promise.resolve();
});

realPostgresRolesOnly('a test marked realPostgresRolesOnly runs only with CLA_ROLE_TESTS=1', () => {
  expect(realPostgres).toBe(true);
  expect(process.env['CLA_ROLE_TESTS']).toBe('1');
  return Promise.resolve();
});
