// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { compareNames } from '../code-caps/types.ts';
import { runLeaks } from './runner.ts';
import { harness, trace } from './test-support.ts';

// E20-S07: the exit code of the wrapper, with a scripted memlab. 0 clean, 1 a leak, 2 an error, and never 0 after an error.

const LEAK = { leaks: [trace('0: [Window](native) @1', '1:   --retainedRows (property)--->  [Array](object) @2')] };

test('a scenario with no leak exits 0 and prints its name and the count', async () => {
  const run = harness();
  expect(await runLeaks([], run.deps)).toBe(0);
  expect(run.out).toEqual([
    'scenario canary: running',
    'scenario canary: 0 leaks',
    'leaks: 1 scenario(s), 0 leaked, 0 failed: exit code 0',
  ]);
  expect(run.err).toEqual([]);
});

test('a scenario with leaks exits 1 and prints the count and the trace', async () => {
  const run = harness({ memlab: () => Promise.resolve(LEAK) });
  expect(await runLeaks([], run.deps)).toBe(1);
  expect(run.out).toEqual([
    'scenario canary: running',
    'scenario canary: 1 leak',
    '  trace 1 of 1:',
    '    0: [Window](native) @1',
    '    1:   --retainedRows (property)--->  [Array](object) @2',
    'leaks: 1 scenario(s), 1 leaked, 0 failed: exit code 1',
  ]);
  expect(run.err).toEqual([]);
});

test('the full traces of a scenario are written next to its snapshots as leaks.json', async () => {
  const run = harness({ memlab: () => Promise.resolve(LEAK) });
  await runLeaks([], run.deps);
  expect(run.madeDirectories).toEqual(['/repo/reports/leaks/canary/memlab']);
  expect([...run.written.keys()]).toEqual(['/repo/reports/leaks/canary/leaks.json']);
  expect(JSON.parse(run.written.get('/repo/reports/leaks/canary/leaks.json') ?? '')).toEqual(LEAK.leaks);
});

test('memlab is given the scenario, a work directory inside the report, the Chromium path and no warm-up', async () => {
  const run = harness({ listing: ['one.ts'] });
  await runLeaks([], run.deps);
  const [call] = run.memlabCalls;
  expect(run.memlabCalls).toHaveLength(1);
  expect(call?.options.workDir).toBe('/repo/reports/leaks/one/memlab');
  expect(call?.options.chromiumBinary).toBe('/browsers/chromium/chrome');
  expect(call?.options.skipWarmup).toBe(true);
  expect(Object.keys(call?.options.scenario ?? {}).sort(compareNames)).toEqual(['action', 'back', 'url']);
  expect(run.loaded).toEqual(['/repo/tests/leaks/scenarios/one.ts']);
});

test('the fixture origin is in the environment while memlab runs, and the server is closed after the last scenario', async () => {
  const run = harness({ listing: ['a.ts', 'b.ts'] });
  await runLeaks([], run.deps);
  expect(run.server).toEqual({ started: 1, closed: 1 });
  expect(run.memlabCalls.map((call) => call.origin)).toEqual(['http://127.0.0.1:40123', 'http://127.0.0.1:40123']);
});

test('the origin of the dashboard is in the environment too (E18-S12), and its server is closed with the other one', async () => {
  const run = harness({ listing: ['a.ts', 'b.ts'] });
  await runLeaks([], run.deps);
  expect(run.app).toEqual({ started: 1, closed: 1 });
  expect(run.memlabCalls.map((call) => call.appOrigin)).toEqual(['http://127.0.0.1:40456', 'http://127.0.0.1:40456']);
});

test('a dashboard server that cannot start exits 2, the fixture server is closed again, and no scenario runs', async () => {
  const run = harness({ serveApp: () => Promise.reject(new Error('listen EADDRINUSE: 127.0.0.1:40456')) });
  expect(await runLeaks([], run.deps)).toBe(2);
  expect(run.err).toEqual(['leaks: listen EADDRINUSE: 127.0.0.1:40456']);
  expect(run.server).toEqual({ started: 1, closed: 1 });
  expect(run.app.closed).toBe(0);
  expect(run.memlabCalls).toEqual([]);
});

test('every scenario of the directory runs, in order, and one leak among clean ones still exits 1', async () => {
  const run = harness({
    listing: ['c.ts', 'a.ts', 'b.ts'],
    memlab: (name) => Promise.resolve(name === 'b' ? LEAK : { leaks: [] }),
  });
  expect(await runLeaks([], run.deps)).toBe(1);
  expect(run.loaded.map((file) => file.split('/').at(-1))).toEqual(['a.ts', 'b.ts', 'c.ts']);
  expect(run.out.at(-1)).toBe('leaks: 3 scenario(s), 1 leaked, 0 failed: exit code 1');
});

test('files named on the command line are the only ones run', async () => {
  const run = harness({ listing: ['never.ts'] });
  expect(await runLeaks(['tests/leaks/control/leaking.ts'], run.deps)).toBe(0);
  expect(run.loaded).toEqual(['/work/tests/leaks/control/leaking.ts']);
  expect(run.madeDirectories).toEqual(['/repo/reports/leaks/leaking/memlab']);
});

test('a memlab error exits 2 with the message on stderr, and the scenarios after it still run', async () => {
  const run = harness({
    listing: ['a.ts', 'b.ts'],
    memlab: (name) =>
      name === 'a' ? Promise.reject(new Error('No element found for selector: #x')) : Promise.resolve({ leaks: [] }),
  });
  expect(await runLeaks([], run.deps)).toBe(2);
  expect(run.err).toEqual(['scenario a: ERROR No element found for selector: #x']);
  expect(run.out).toContain('scenario b: 0 leaks');
  expect(run.out.at(-1)).toBe('leaks: 2 scenario(s), 0 leaked, 1 failed: exit code 2');
  expect(run.server.closed).toBe(1);
});

test('memlab halting path throws a string, which is an error as well', async () => {
  // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the point of the test: memlab's haltOrThrow throws the string 'unreachable'
  const run = harness({ memlab: () => Promise.reject('unreachable') });
  expect(await runLeaks([], run.deps)).toBe(2);
  expect(run.err).toEqual(['scenario canary: ERROR unreachable']);
});

test('an error and a leak in the same run exit 2, never 1 and never 0', async () => {
  const run = harness({
    listing: ['a.ts', 'b.ts'],
    memlab: (name) => (name === 'a' ? Promise.resolve(LEAK) : Promise.reject(new Error('browser crashed'))),
  });
  expect(await runLeaks([], run.deps)).toBe(2);
});

test.each([
  [
    'a module without a scenario',
    () => Promise.resolve({ default: 'nothing' }),
    'must default-export { url, action, back }',
  ],
  [
    'a file that cannot be imported',
    () => Promise.reject(new Error('SyntaxError: Unexpected token')),
    'SyntaxError: Unexpected token',
  ],
])('%s is an error of that scenario, exit 2, and memlab is not called', async (_label, load, message) => {
  const run = harness({ load });
  expect(await runLeaks([], run.deps)).toBe(2);
  expect(run.err[0]).toContain(message);
  expect(run.memlabCalls).toEqual([]);
});

test('a run of nothing exits 2 and does not even start the server', async () => {
  const run = harness({ listing: ['README.md', 'types.d.ts'] });
  expect(await runLeaks([], run.deps)).toBe(2);
  expect(run.err).toEqual(['leaks: no scenario to run in /repo/tests/leaks/scenarios: a run of nothing is not a pass']);
  expect(run.server.started).toBe(0);
  expect(run.memlabCalls).toEqual([]);
});

test('a scenarios directory that cannot be listed exits 2 with the reason', async () => {
  const run = harness();
  const deps = {
    ...run.deps,
    files: {
      ...run.deps.files,
      list: () => {
        throw new Error("ENOENT: no such file or directory, scandir '/repo/tests/leaks/scenarios'");
      },
    },
  };
  expect(await runLeaks([], deps)).toBe(2);
  expect(run.err).toEqual(["leaks: ENOENT: no such file or directory, scandir '/repo/tests/leaks/scenarios'"]);
});

test('a server that cannot start exits 2 with the reason, and no scenario runs', async () => {
  const run = harness({
    serve: () => Promise.reject(new Error('listen EADDRINUSE: address already in use 127.0.0.1:40123')),
  });
  expect(await runLeaks([], run.deps)).toBe(2);
  expect(run.err).toEqual(['leaks: listen EADDRINUSE: address already in use 127.0.0.1:40123']);
  expect(run.memlabCalls).toEqual([]);
});

test('control characters in an error message are shown escaped', async () => {
  const run = harness({ serve: () => Promise.reject(new Error('bad\nline')) });
  await runLeaks([], run.deps);
  expect(run.err).toEqual(['leaks: bad\\x0aline']);
});

test('a process that memlab ends in the middle of the run (process.exit) becomes exit code 2', async () => {
  const run = harness({
    memlab: () => {
      run.process.fireExit(1);
      return Promise.resolve({ leaks: [] });
    },
  });
  await runLeaks([], run.deps);
  expect(run.process.exitCode).toBe(2);
  expect(run.err).toEqual([
    'leaks: the process was ended with code 1 before every scenario had finished: that is an error',
  ]);
});

const ENDINGS = [
  [0, () => Promise.resolve({ leaks: [] })],
  [1, () => Promise.resolve(LEAK)],
  [2, () => Promise.reject(new Error('browser crashed'))],
] as const;

test.each(ENDINGS)(
  'after the wrapper has returned its code %i, the exit that follows keeps what the entry file set',
  async (code, memlab) => {
    const run = harness({ memlab });
    expect(await runLeaks([], run.deps)).toBe(code);
    run.process.exitCode = code;
    run.process.fireExit(code);
    expect(run.process.exitCode).toBe(code);
  },
);
