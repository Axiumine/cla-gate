// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import process from 'node:process';
import { expect, test, vi } from 'vitest';
import { exists, readText } from '../ci/lib/test-support.ts';
import { tempDir } from '../code-caps/test-support.ts';
import { ROOT } from '../semgrep-rules/test-support.ts';
import { runChild, systemDeps } from './mutate-run.ts';

// E20-S04: the one place that starts a process. Real processes, Node itself running small scripts.

/** Runs `script` under this Node, in the repository root, with `env` and a budget in milliseconds. */
function run(script: string, env: Record<string, string> = {}, budgetMs?: number) {
  return runChild(process.execPath, ['-e', script], env, budgetMs);
}

test('the outcome carries the exit code of the child, and no budget means it is never timed out', async () => {
  expect(await run('process.exit(0)')).toEqual({ code: 0, timedOut: false });
  expect(await run('process.exit(3)')).toEqual({ code: 3, timedOut: false });
});

test('the child gets exactly the environment it is given, and runs in the repository root', async () => {
  const mark = path.join(tempDir(), 'seen.json');
  const script = `require('node:fs').writeFileSync(${JSON.stringify(mark)}, JSON.stringify({ cwd: process.cwd(), shard: process.env.STRYKER_SHARD, home: process.env.HOME ?? null }))`;
  await run(script, { STRYKER_SHARD: 'shared' });
  expect(JSON.parse(readText(mark))).toEqual({ cwd: ROOT, shard: 'shared', home: null });
});

test('a child that finishes before its budget is not timed out', async () => {
  expect(await run('process.exit(0)', {}, 60_000)).toEqual({ code: 0, timedOut: false });
});

test('when the budget is spent the child gets SIGINT and is waited for until it has saved and exited', async () => {
  const mark = path.join(tempDir(), 'saved');
  const script = `
    process.on('SIGINT', () => {
      setTimeout(() => { require('node:fs').writeFileSync(${JSON.stringify(mark)}, 'saved after SIGINT'); process.exit(130); }, 200);
    });
    setInterval(() => {}, 1000);
  `;
  const outcome = await run(script, {}, 2500);
  expect(outcome).toEqual({ code: 130, timedOut: true });
  expect(exists(mark)).toBe(true);
  expect(readText(mark)).toBe('saved after SIGINT');
});

test('a child ended by a signal other than the budget is exit code 1', async () => {
  expect(await run("process.kill(process.pid, 'SIGKILL')")).toEqual({ code: 1, timedOut: false });
});

test('a binary that cannot start is exit code 127, and the reason is printed', async () => {
  const written = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    const missing = path.join(tempDir(), 'no-such-binary');
    expect(await runChild(missing, [], {}, undefined)).toEqual({ code: 127, timedOut: false });
    expect(String(written.mock.calls[0]?.[0])).toContain(`cannot start ${missing}`);
  } finally {
    written.mockRestore();
  }
});

test("the system dependency starts Stryker's own entry point under this Node, not a shell or yarn", async () => {
  const bin = path.join(ROOT, 'node_modules/@stryker-mutator/core/bin/stryker.js');
  expect(exists(bin)).toBe(true);
  const outcome = await systemDeps.run(['--version'], {}, undefined);
  expect(outcome).toEqual({ code: 0, timedOut: false });
});
