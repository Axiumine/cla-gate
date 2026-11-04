// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { listNames } from '../../scripts/smoke/files.ts';
import { runOneOff } from '../../scripts/smoke/one-off.ts';
import { inspectService, output, sqlAs } from '../../scripts/smoke/probe.ts';
import { clock } from '../../scripts/smoke/system.ts';
import { eventually, timed } from '../../scripts/smoke/wait.ts';
import { ownStack } from './scenario.ts';
import { getFrom } from './support.ts';

// E19-S12, failure injection. The stack starts with `postgres` only, so that the first scenario can run two migrations at once
// on an empty database; then the rest starts, and the database is stopped and started, the application is started with a
// setting it must refuse, and it is stopped.

const stack = ownStack({ scenario: 'failure', services: ['postgres'] });
const MIGRATIONS = path.resolve(import.meta.dirname, '../../migrations');
const READY_AGAIN_MS = 30_000;
const REFUSAL_MS = 5000;
const STOP_MS = 10_000;
const compare = (a: string, b: string): number => a.localeCompare(b);
let started = '';

/** The names a `migrations applied: a, b` line lists, over all the output given. */
function appliedIn(...outputs: string[]): string[] {
  return outputs
    .flatMap((text) => text.split('\n'))
    .filter((line) => line.startsWith('migrations applied: '))
    .flatMap((line) => line.slice('migrations applied: '.length).split(', '));
}

test('two migrate runs started together both exit 0, and every migration is applied once', async () => {
  const files = listNames(MIGRATIONS).filter((name) => name.endsWith('.sql'));
  const run = () => stack().compose(['run', '--rm', 'migrate']);
  const results = await Promise.all([run(), run()]);
  expect(
    results.map((result) => result.code),
    results.map(output).join('\n'),
  ).toEqual([0, 0]);
  const applied = appliedIn(...results.map((result) => result.stdout));
  expect(applied.toSorted(compare)).toEqual(files.toSorted(compare));
  const rows = await sqlAs(stack(), 'cla_owner', 'select count(*), count(distinct name) from schema_migrations');
  expect([rows.code, rows.stdout.trim()]).toEqual([0, `${files.length}|${files.length}`]);
});

test('the rest of the stack starts on the migrated database', async () => {
  const up = await stack().compose(['up', '--detach', '--wait', '--wait-timeout', '180']);
  expect(up.code, output(up)).toBe(0);
  expect((await getFrom(stack(), '/readyz')).status).toBe(200);
  started = (await inspectService(stack(), 'app')).State.StartedAt;
});

test('with postgres stopped /readyz answers 503 while /healthz stays 200 and the application keeps running', async () => {
  const stopped = await stack().compose(['stop', 'postgres']);
  expect(stopped.code, output(stopped)).toBe(0);
  const unavailable = await eventually(clock, '/readyz to answer 503', READY_AGAIN_MS, async () => {
    const response = await getFrom(stack(), '/readyz');
    return response.status === 503 ? response : undefined;
  });
  expect(await unavailable.json()).toEqual({ status: 'unavailable' });
  const live = await getFrom(stack(), '/healthz');
  expect([live.status, await live.json()]).toEqual([200, { status: 'ok' }]);
  const app = await inspectService(stack(), 'app');
  expect([app.State.Status, app.RestartCount, app.State.StartedAt]).toEqual(['running', 0, started]);
});

test('starting postgres again makes /readyz answer 200 within 30 seconds', async () => {
  const restarted = await stack().compose(['start', 'postgres']);
  expect(restarted.code, output(restarted)).toBe(0);
  const { ms } = await timed(clock, () =>
    eventually(clock, '/readyz to answer 200 again', READY_AGAIN_MS, async () => {
      const response = await getFrom(stack(), '/readyz');
      return response.status === 200 ? response : undefined;
    }),
  );
  expect(ms).toBeLessThan(READY_AGAIN_MS);
  const app = await inspectService(stack(), 'app');
  expect([app.State.Status, app.RestartCount, app.State.StartedAt]).toEqual(['running', 0, started]);
});

test('an application started with PUBLIC_BASE_URL=http://example.com in production exits non-zero within 5 seconds and names the variable, not the value', async () => {
  const result = await runOneOff(stack(), clock, 'app', {
    NODE_ENV: 'production',
    PUBLIC_BASE_URL: 'http://example.com',
  });
  expect(result.exitCode, result.output).not.toBe(0);
  expect(result.lifetimeMs).toBeLessThan(REFUSAL_MS);
  expect(result.output).toContain('PUBLIC_BASE_URL');
  expect(result.output).not.toContain('http://example.com');
});

test('docker compose stop app exits 0 within 10 seconds, and the application has shut down by itself with exit code 0', async () => {
  const { value: stopped, ms } = await timed(clock, () => stack().compose(['stop', 'app']));
  expect(stopped.code, output(stopped)).toBe(0);
  expect(ms).toBeLessThan(STOP_MS);
  const app = await inspectService(stack(), 'app');
  expect([app.State.Status, app.State.ExitCode]).toEqual(['exited', 0]);
});
