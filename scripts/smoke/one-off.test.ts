// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import type { ExecResult } from '../ci/lib/exec.ts';
import { fail, ok } from '../ci/lib/test-support.ts';
import { runOneOff } from './one-off.ts';
import type { Clock } from './wait.ts';

// E19-S12: a one-off container of the application, read after it stopped. docker is a stub that records its arguments.

const CLOCK: Clock = { now: () => 0, sleep: () => Promise.resolve() };

/** The part of `docker inspect` the probe reads, for a container in `status` that lived from `started` to `finished`. */
function inspected(status: string, exitCode: number, started: string, finished: string): ExecResult {
  return ok(
    JSON.stringify({
      Id: 'one-off-id',
      RestartCount: 0,
      Config: { User: '10001:10001', Env: [], Labels: {} },
      State: { Status: status, ExitCode: exitCode, StartedAt: started, FinishedAt: finished },
      HostConfig: { ReadonlyRootfs: true, CapDrop: ['ALL'], SecurityOpt: null, PortBindings: null },
      NetworkSettings: { Ports: {} },
    }),
  );
}

const RUNNING = inspected('running', 0, '2026-11-04T10:00:00.000Z', '0001-01-01T00:00:00Z');
const STOPPED = inspected('exited', 1, '2026-11-04T10:00:00.000Z', '2026-11-04T10:00:00.730Z');

/** A stack whose `run` prints `started` and whose docker answers `inspect` from a queue; all calls are recorded. */
function stub(started: ExecResult, inspects: readonly ExecResult[], logs = ok('the refusal\n')) {
  const calls: string[][] = [];
  const queue = [...inspects];
  return {
    calls,
    compose: (args: readonly string[]) => {
      calls.push(['compose', ...args]);
      return Promise.resolve(started);
    },
    docker: (args: readonly string[]) => {
      calls.push(['docker', ...args]);
      const [verb] = args;
      if (verb === 'inspect') {
        return Promise.resolve(queue.length > 1 ? (queue.shift() ?? RUNNING) : (queue[0] ?? RUNNING));
      }
      return Promise.resolve(verb === 'logs' ? logs : ok());
    },
  };
}

test('the service is started detached without its dependencies, with each variable as --env, and read after it stopped', async () => {
  const probe = stub(ok('cla-smoke-x-failure-app-run-1a2b\n'), [RUNNING, STOPPED]);
  const result = await runOneOff(probe, CLOCK, 'app', {
    NODE_ENV: 'production',
    PUBLIC_BASE_URL: 'http://example.com',
  });
  expect(result).toEqual({ exitCode: 1, lifetimeMs: 730, output: 'the refusal' });
  expect(probe.calls).toEqual([
    [
      'compose',
      'run',
      '--detach',
      '--no-deps',
      '--env',
      'NODE_ENV=production',
      '--env',
      'PUBLIC_BASE_URL=http://example.com',
      'app',
    ],
    ['docker', 'inspect', '--format', '{{json .}}', 'cla-smoke-x-failure-app-run-1a2b'],
    ['docker', 'inspect', '--format', '{{json .}}', 'cla-smoke-x-failure-app-run-1a2b'],
    ['docker', 'logs', 'cla-smoke-x-failure-app-run-1a2b'],
    ['docker', 'rm', '--force', '--volumes', 'cla-smoke-x-failure-app-run-1a2b'],
  ]);
});

test('the container name is the last line compose printed', async () => {
  const probe = stub(ok('Container pulling\nthe-name\n'), [STOPPED]);
  await runOneOff(probe, CLOCK, 'app', {});
  expect(probe.calls[1]).toEqual(['docker', 'inspect', '--format', '{{json .}}', 'the-name']);
});

test.each([
  ['compose fails', fail('no such service: app'), 'docker compose run app failed (exit 1): no such service: app'],
  ['compose prints no name', ok(''), 'docker compose run app failed (exit 0): '],
])('a run that does not start is an error with its output when %s', async (_label, started, message) => {
  await expect(runOneOff(stub(started, [STOPPED]), CLOCK, 'app', {})).rejects.toThrow(message);
});

test('a container that is still running when the time is over is an error naming the service', async () => {
  let time = 0;
  const clock: Clock = {
    now: () => time,
    sleep: (ms) => {
      time += ms;
      return Promise.resolve();
    },
  };
  const probe = stub(ok('name\n'), [RUNNING]);
  await expect(runOneOff(probe, clock, 'app', {})).rejects.toThrow(
    'the one-off app to stop did not happen within 30000 ms',
  );
  expect(probe.calls.some((call) => call[1] === 'rm')).toBe(false);
});
