// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { afterEach, expect, test, vi } from 'vitest';
import { exists, readText } from '../ci/lib/test-support.ts';
import { tempDir } from '../code-caps/test-support.ts';
import { ROOT } from '../semgrep-rules/test-support.ts';
import { skipEnv, TOKEN } from './test-support.ts';

// E20-S04: scripts/mutation-gate/decide-skip.ts only wires the environment, the streams, `fetch` and a file append into
// runSkipCli and turns its result into the exit code. The last test runs it for real under Node, as the job does before
// `yarn install`.

afterEach(() => {
  process.exitCode = undefined;
  vi.doUnmock('./skip-cli.ts');
  vi.resetModules();
  vi.restoreAllMocks();
});

type Deps = Parameters<typeof import('./skip-cli.ts').runSkipCli>[2];

/** Loads decide-skip.ts with a step that records what it was given and answers `code`. */
async function wired(code: number) {
  const runSkipCli = vi.fn<(env: unknown, io: unknown, deps: Deps) => Promise<number>>(() => Promise.resolve(code));
  vi.doMock('./skip-cli.ts', () => ({ runSkipCli }));
  vi.resetModules();
  await import('./decide-skip.ts');
  const [env, io, deps] = runSkipCli.mock.calls[0] ?? [];
  return { calls: runSkipCli.mock.calls.length, env, io, deps };
}

test('decide-skip hands the environment, the streams, fetch and a file append to the step and exits with its code', async () => {
  const wiring = await wired(0);
  const { stdIo } = await import('../ci/lib/io.ts');
  expect(wiring.calls).toBe(1);
  expect(wiring.env).toBe(process.env);
  expect(wiring.io).toBe(stdIo);
  expect(wiring.deps?.fetcher).toBe(fetch);
  expect(process.exitCode).toBe(0);
  vi.resetModules();
  expect((await wired(3)).calls).toBe(1);
  expect(process.exitCode).toBe(3);
});

test('the file append of the real wiring appends, and does not replace what the runner put in the file', async () => {
  const wiring = await wired(0);
  const file = path.join(tempDir(), 'output');
  wiring.deps?.appendFile(file, 'first=1\n');
  wiring.deps?.appendFile(file, 'skip=true\n');
  expect(readText(file)).toBe('first=1\nskip=true\n');
});

test('run under plain node, with nothing installed that it needs and an API that refuses the connection, it runs the shard: exit 0 and skip=false', () => {
  const directory = tempDir();
  const output = path.join(directory, 'output');
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/mutation-gate/decide-skip.ts')], {
    // Port 9 on the loopback: nothing listens, so the request fails at once and for real, with no network.
    env: {
      PATH: process.env['PATH'] ?? '',
      ...skipEnv({ GITHUB_API_URL: 'https://127.0.0.1:9', GITHUB_OUTPUT: output }),
    },
    encoding: 'utf8',
    cwd: directory,
  });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(
    'mutation skip check (config): run, the lookup did not give an answer (unexpected TypeError)\n',
  );
  expect(exists(output)).toBe(true);
  expect(readText(output)).toBe('skip=false\n');
  expect(result.stdout + result.stderr).not.toContain(TOKEN);
});

/** The module specifiers that Node loads when it runs `file`: every import that is not `import type`, followed through the files of the repository. */
function runtimeImports(file: string, seen = new Set<string>()): string[] {
  if (seen.has(file)) {
    return [];
  }
  seen.add(file);
  const source = readText(file);
  const specifiers = [...source.matchAll(/^import (?!type )[^;]*?from '([^']+)';/gms)].map((match) => match[1] ?? '');
  const local = specifiers.filter((specifier) => specifier.startsWith('.'));
  return [
    ...specifiers,
    ...local.flatMap((specifier) => runtimeImports(path.resolve(path.dirname(file), specifier), seen)),
  ];
}

test('everything the step loads is Node or a file of this repository, so it needs no yarn install', () => {
  const specifiers = runtimeImports(path.join(ROOT, 'scripts/mutation-gate/decide-skip.ts'));
  expect(specifiers.length).toBeGreaterThan(8);
  for (const specifier of specifiers) {
    expect(specifier, specifier).toMatch(/^(node:[a-z/]+|\.\.?\/.*\.ts)$/);
  }
  expect(specifiers).toContain('./skip-http.ts');
  expect(specifiers).toContain('../ci/lib/guard-types.ts');
});
