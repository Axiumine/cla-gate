// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { activeLines, listDir, ROOT, repoText, SCRIPTS } from '../semgrep-rules/test-support.ts';

// E19-S08: the files and scripts that wire the container smoke test into the repository.

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

test('yarn smoke runs the smoke project of Vitest with SMOKE=1, and yarn ci:smoke the clean-up helper', () => {
  expect(SCRIPTS.get('smoke')).toBe('SMOKE=1 vitest run --project smoke');
  expect(SCRIPTS.get('ci:smoke')).toBe('node scripts/ci/smoke.ts');
});

test('the smoke project reads tests/smoke only, starts one stack for all files, and runs the files one after the other', async () => {
  const { smokeProject, scriptsProject, serverProject, webProject } = await import('../../vitest.projects.ts');
  expect(smokeProject.test).toMatchObject({
    name: 'smoke',
    include: ['tests/smoke/**/*.test.ts'],
    globalSetup: ['tests/smoke/global-setup.ts'],
    fileParallelism: false,
  });
  const sample = 'tests/smoke/boot.test.ts';
  for (const other of [scriptsProject, serverProject, webProject]) {
    expect(other.test?.include?.some((pattern) => path.matchesGlob(sample, pattern))).toBe(false);
  }
});

/** The names of the projects vitest.config.ts has with SMOKE set to `value`. */
async function projectNames(value: string): Promise<string[]> {
  vi.resetModules();
  vi.stubEnv('SMOKE', value);
  const { default: config } = await import('../../vitest.config.ts');
  const named = z.object({ test: z.object({ name: z.string() }) });
  return (config.test?.projects ?? []).flatMap((project) => {
    const parsed = named.safeParse(project);
    return parsed.success ? [parsed.data.test.name] : [];
  });
}

test.each([[''], ['0'], ['true']])(
  'with SMOKE=%j the run has no smoke project, so yarn test and yarn coverage never start Docker',
  async (value) => {
    expect(await projectNames(value)).toEqual(['scripts', 'server', 'web']);
  },
);

test('with SMOKE=1 the smoke project joins the others', async () => {
  expect(await projectNames('1')).toEqual(['scripts', 'server', 'web', 'smoke']);
});

test('the coverage scope is src and scripts, so tests/smoke is outside it without any exclusion', async () => {
  vi.stubEnv('SMOKE', '');
  const { default: config } = await import('../../vitest.config.ts');
  const include = config.test?.coverage?.include ?? [];
  expect(include.some((pattern) => path.matchesGlob('tests/smoke/support.ts', pattern))).toBe(false);
  expect(include.some((pattern) => path.matchesGlob('scripts/smoke/stack.ts', pattern))).toBe(true);
});

test('the report directory of the logs is git-ignored, because the caps tool and the linters follow .gitignore', () => {
  expect(activeLines(repoText('.gitignore'))).toContain('reports/');
});

test('Knip finds the test files and the global setup, and the e2e TypeScript project covers tests/smoke', () => {
  const knip = z.object({ entry: z.array(z.string()) }).parse(JSON.parse(repoText('knip.json')));
  expect(knip.entry).toEqual(expect.arrayContaining(['tests/smoke/*.test.ts', 'tests/smoke/global-setup.ts']));
  const project = z.object({ include: z.array(z.string()) }).parse(JSON.parse(repoText('tsconfig.e2e.json')));
  expect(project.include).toContain('tests/smoke/**/*.ts');
});

/** The control flow a logic-free entry file must not have. */
const CONTROL_FLOW = /\b(if|else|for|while|do|switch|try|catch|throw)\b\s*[({]|\?\s|&&|\|\|/;

test.each([['tests/smoke/global-setup.ts'], ['scripts/ci/smoke.ts']])(
  '%s is logic-free: no branch, loop or error handling of its own',
  (file) => {
    const code = activeLines(repoText(file))
      .filter((line) => !line.startsWith('//'))
      .join('\n');
    expect(code).not.toMatch(CONTROL_FLOW);
  },
);

test('every test file of tests/smoke connects to the stack of the global setup and starts none of its own', () => {
  const files = listDir(path.join(ROOT, 'tests/smoke')).filter((name) => name.endsWith('.test.ts'));
  expect(files).toEqual(['boot.test.ts', 'compose-config.test.ts', 'hardening.test.ts', 'roles.test.ts']);
  for (const file of files) {
    const text = repoText(`tests/smoke/${file}`);
    expect(text).toContain("from './support.ts'");
    expect(text).not.toContain('startStack');
  }
});
