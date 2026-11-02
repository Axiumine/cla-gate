// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { readText } from '../ci/lib/test-support.ts';
import { makeRepo, tempDir } from '../code-caps/test-support.ts';

// E20-S16: Biome's own CLI judges violating source text in a temporary directory. The directory holds the repository's
// real biome.json (less its git integration, which a directory outside a repository cannot use), so the verdict is the
// one `yarn lint:biome` gives. No violating file exists in the repository, and nothing is excluded from a gate.

const ROOT = path.resolve(import.meta.dirname, '../..');
const BIOME = path.join(ROOT, 'node_modules/.bin/biome');

const configSchema = z.record(z.string(), z.unknown());
const repositoryConfig = configSchema.parse(JSON.parse(readText(path.join(ROOT, 'biome.json'))));
const config = Object.fromEntries(
  Object.entries(repositoryConfig).filter(([key]) => key !== 'vcs' && key !== '$schema'),
);

/** What `biome ci --error-on-warnings` makes of a directory that holds `source` as `example.ts`. */
function biome(source: string): { status: number | null; output: string } {
  const directory = tempDir();
  makeRepo(directory, { 'biome.json': JSON.stringify(config), 'example.ts': source });
  const result = spawnSync(BIOME, ['ci', '--error-on-warnings', '--colors=off', 'example.ts'], {
    cwd: directory,
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

test('the unsuppressed fixture is a Biome error, so the tests below prove the suppression and nothing else', () => {
  const { status, output } = biome('debugger;\n');
  expect(status).toBe(1);
  expect(output).toContain('lint/suspicious/noDebugger');
});

test.each([
  ['a biome-ignore without an explanation', '// biome-ignore lint/suspicious/noDebugger\ndebugger;\n'],
  ['a biome-ignore with an empty explanation', '// biome-ignore lint/suspicious/noDebugger:\ndebugger;\n'],
  ['a block biome-ignore without an explanation', '/* biome-ignore lint/suspicious/noDebugger */\ndebugger;\n'],
])('%s is an error and suppresses nothing', (_what, source) => {
  const { status, output } = biome(source);
  expect(status).toBe(1);
  expect(output).toContain('suppressions/parse');
  expect(output).toContain('lint/suspicious/noDebugger');
});

test('a biome-ignore with an explanation passes', () => {
  const source = '// biome-ignore lint/suspicious/noDebugger: the fixture needs a debugger statement\ndebugger;\n';
  const { status, output } = biome(source);
  expect(status).toBe(0);
  expect(output).toContain('Checked 1 file');
});
