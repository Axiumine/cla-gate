// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { readText } from '../ci/lib/test-support.ts';
import { activeLines, ROOT, repoText, SCRIPTS } from '../semgrep-rules/test-support.ts';

// E20-S06: the files and scripts that wire the Playwright harness into the repository.

const tsconfig = z.object({
  extends: z.string().optional(),
  files: z.array(z.string()).optional(),
  include: z.array(z.string()).optional(),
  references: z.array(z.object({ path: z.string() })).optional(),
  compilerOptions: z.record(z.string(), z.unknown()).optional(),
});

function readTsconfig(file: string) {
  const parsed: unknown = JSON.parse(repoText(file));
  return tsconfig.parse(parsed);
}

test('yarn e2e is playwright test', () => {
  expect(SCRIPTS.get('e2e')).toBe('playwright test');
});

test('yarn e2e:update runs the pinned image with the repository mounted, as the current user, and writes baselines', () => {
  const script = SCRIPTS.get('e2e:update') ?? '';
  expect(script).toMatch(/^docker run --rm --init --ipc=host /);
  expect(script).toContain('--env E2E_CONTAINER=1');
  expect(script).toContain('--volume "$PWD:/work" --workdir /work');
  expect(script).toContain('--user "$(id -u):$(id -g)"');
  expect(script).toContain('--network host');
  expect(script).toMatch(
    / mcr\.microsoft\.com\/playwright:v\d+\.\d+\.\d+-noble@sha256:[0-9a-f]{64} yarn e2e --update-snapshots$/,
  );
});

test('yarn e2e:update gives the container the database of the caller and nothing else of the caller environment', () => {
  const script = SCRIPTS.get('e2e:update') ?? '';
  const names = script
    .split(' --env ')
    .slice(1)
    .map((part) => (part.split(' ')[0] ?? '').split('=')[0]);
  expect(names).toEqual(['E2E_CONTAINER', 'HOME', 'SKIP_YARN_COREPACK_CHECK', 'CI', 'DATABASE_URL']);
  expect(script).not.toContain('DATABASE_URL=');
});

test('yarn ci:e2e is the helper script of the e2e job', () => {
  expect(SCRIPTS.get('ci:e2e')).toBe('node scripts/ci/e2e.ts');
});

test('the e2e project is a root reference and a type-coverage project of its own', () => {
  const references = readTsconfig('tsconfig.json').references?.map((reference) => reference.path);
  expect(references).toContain('./tsconfig.e2e.json');
  expect(SCRIPTS.get('type-coverage')).toContain('type-coverage --strict --at-least 100 -p tsconfig.e2e.json');
});

test('the e2e project covers the specs and the leak scenarios, emits nothing and has the strict flags of the base', () => {
  const project = readTsconfig('tsconfig.e2e.json');
  expect(project.extends).toBe('./tsconfig.base.json');
  expect(project.include).toEqual(['e2e/**/*.ts', 'tests/leaks/**/*.ts']);
  expect(project.compilerOptions?.['composite']).toBeUndefined();
  expect(project.compilerOptions?.['noEmit']).not.toBe(false);
  const base = readTsconfig('tsconfig.base.json').compilerOptions;
  expect(base).toMatchObject({
    strict: true,
    noEmit: true,
    erasableSyntaxOnly: true,
    exactOptionalPropertyTypes: true,
  });
});

test('the node-config project includes playwright.config.ts through its *.config.ts pattern', () => {
  expect(readTsconfig('tsconfig.node.json').include).toContain('*.config.ts');
  expect(readText(path.join(ROOT, 'playwright.config.ts'))).toContain('defineConfig');
});

test('the reports and test results of a run are git-ignored, and the baselines are binary files', () => {
  const ignored = activeLines(repoText('.gitignore'));
  expect(ignored).toEqual(expect.arrayContaining(['playwright-report/', 'test-results/']));
  expect(activeLines(repoText('.gitattributes'))).toContain('e2e/__screenshots__/** binary');
});

test('Knip does not count the e2e tooling as production code', () => {
  const knip = z.object({ project: z.array(z.string()) }).parse(JSON.parse(repoText('knip.json')));
  expect(knip.project).toContain('!scripts/e2e/**!');
});

test('Biome applies its Playwright rules to e2e/ only, because other code has functions called describe', () => {
  const biome = z
    .object({
      linter: z.object({ domains: z.record(z.string(), z.string()) }),
      overrides: z.array(
        z.object({ includes: z.array(z.string()), linter: z.object({ domains: z.record(z.string(), z.string()) }) }),
      ),
    })
    .parse(JSON.parse(repoText('biome.json')));
  expect(biome.linter.domains).toEqual({ playwright: 'none' });
  expect(biome.overrides).toEqual([{ includes: ['e2e/**'], linter: { domains: { playwright: 'recommended' } } }]);
});

test('the canary page is static: no script, no stylesheet link, no image and no remote address', () => {
  const page = repoText('e2e/fixtures/canary.html');
  expect(page).not.toMatch(/<script|<link|<img|<iframe|@import|url\(|https?:|\/\/[a-z]/i);
  expect(page).toContain('<h1>Visual canary</h1>');
});

test('the canary baseline is committed, as a PNG', () => {
  const baseline = path.join(ROOT, 'e2e', '__screenshots__', 'canary.visual.spec.ts', 'canary.png');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a file inside the repository
  expect(fs.readFileSync(baseline).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
});
