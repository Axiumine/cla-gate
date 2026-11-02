// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { expect, test, vi } from 'vitest';
import { z } from 'zod';
import { makeRepo, tempDir } from '../code-caps/test-support.ts';
import { ROOT } from '../semgrep-rules/test-support.ts';
import { REFUSAL, VISUAL_SKIP_REASON } from './container-guards.ts';

// E20-S06: the real Playwright CLI, run over a scratch project that uses the repository's own global setup and support
// module. No browser and no server are involved: it shows that the guards act where Playwright calls them.

// Each test starts the real CLI once; a busy runner may need more than the default five seconds.
vi.setConfig({ testTimeout: 30_000 });

const CLI = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
const SUPPORT = path.join(ROOT, 'e2e', 'support', 'test.ts');
const SETUP = path.join(ROOT, 'e2e', 'global-setup.ts');
const PLAYWRIGHT_MODULE = path.join(ROOT, 'node_modules', '@playwright', 'test', 'index.mjs');

const SPEC = (name: string) =>
  `import { expect, test } from '${SUPPORT}';\ntest('${name}', () => {\n  expect(1 + 1).toBe(2);\n});\n`;
const CONFIG = `import { defineConfig } from '${PLAYWRIGHT_MODULE}';
export default defineConfig({ testDir: '.', globalSetup: '${SETUP}', updateSnapshots: 'none', reporter: 'json', retries: 0 });
`;

/** A scratch project with one ordinary spec and one visual spec. */
function project(): string {
  const root = tempDir();
  makeRepo(root, {
    'package.json': '{"type":"module"}',
    'pw.config.ts': CONFIG,
    'plain.spec.ts': SPEC('plain'),
    'sample.visual.spec.ts': SPEC('visual'),
  });
  return root;
}

const statsSchema = z.object({
  stats: z.object({ expected: z.number(), skipped: z.number(), unexpected: z.number() }),
});

/** Runs `playwright test` in `root`, in the container (`E2E_CONTAINER=1`) or on the host (the variable removed). */
function run(root: string, inContainer: boolean, ...args: string[]) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== 'E2E_CONTAINER'));
  const result = spawnSync(process.execPath, [CLI, 'test', '--config', path.join(root, 'pw.config.ts'), ...args], {
    cwd: root,
    env: inContainer ? { ...env, E2E_CONTAINER: '1' } : env,
    encoding: 'utf8',
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

test('on the host the visual spec is skipped with the reason and the ordinary spec runs', () => {
  const { code, out } = run(project(), false);
  expect(code).toBe(0);
  const parsed: unknown = JSON.parse(out);
  expect(statsSchema.parse(parsed).stats).toMatchObject({ expected: 1, skipped: 1, unexpected: 0 });
  expect(out).toContain(VISUAL_SKIP_REASON);
});

test('in the container both specs run and nothing is skipped', () => {
  const { code, out } = run(project(), true);
  expect(code).toBe(0);
  const parsed: unknown = JSON.parse(out);
  expect(statsSchema.parse(parsed).stats).toMatchObject({ expected: 2, skipped: 0, unexpected: 0 });
  expect(out).not.toContain(VISUAL_SKIP_REASON);
});

test.each([['--update-snapshots'], ['--update-snapshots=all'], ['--update-snapshots=missing']])(
  'on the host %s is refused before any test runs',
  (flag) => {
    const { code, out, err } = run(project(), false, flag);
    expect(code).not.toBe(0);
    expect(`${out}${err}`).toContain(REFUSAL);
    expect(out).not.toContain('"expected": 1');
  },
);

test('on the host a run that writes no baseline is not refused', () => {
  const { code, err } = run(project(), false, '--update-snapshots=none');
  expect(code).toBe(0);
  expect(err).not.toContain(REFUSAL);
});

test('in the container --update-snapshots is allowed', () => {
  const { code, err } = run(project(), true, '--update-snapshots');
  expect(code).toBe(0);
  expect(err).not.toContain(REFUSAL);
});
