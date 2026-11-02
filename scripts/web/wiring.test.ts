// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { z } from 'zod';
import vitestConfig from '../../vitest.config.ts';
import { scriptsProject, serverProject, webProject } from '../../vitest.projects.ts';
import { repoText, SCRIPTS } from '../semgrep-rules/test-support.ts';

// E17-S01: the files and scripts that put the web project (src/web) under every gate the server is under.

const tsconfigSchema = z.object({
  extends: z.string().optional(),
  files: z.array(z.string()).optional(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  references: z.array(z.object({ path: z.string() })).optional(),
  compilerOptions: z.record(z.string(), z.unknown()).optional(),
});

function readTsconfig(file: string) {
  return tsconfigSchema.parse(JSON.parse(repoText(file)));
}

const packageSchema = z.object({
  dependencies: z.record(z.string(), z.string()),
  devDependencies: z.record(z.string(), z.string()),
});
const manifest = packageSchema.parse(JSON.parse(repoText('package.json')));

test('tsconfig.web.json extends the base, and sets the browser options the story names', () => {
  const config = readTsconfig('tsconfig.web.json');
  expect(config.extends).toBe('./tsconfig.base.json');
  expect(config.compilerOptions).toMatchObject({
    moduleResolution: 'bundler',
    jsx: 'react-jsx',
    noEmit: true,
    types: ['vite/client'],
  });
  expect(config.compilerOptions?.['lib']).toEqual(expect.arrayContaining(['DOM', 'DOM.Iterable']));
  expect(config.include).toEqual(['src/web/**/*', 'src/shared/**/*']);
});

test('the strict flags come from the base, which the web project does not loosen', () => {
  const overrides = Object.keys(readTsconfig('tsconfig.web.json').compilerOptions ?? {});
  const strict = Object.keys(readTsconfig('tsconfig.base.json').compilerOptions ?? {}).filter((name) =>
    /^(strict|no[A-Z]|exactOptional|verbatim|erasable)/.test(name),
  );
  expect(strict).toContain('strict');
  expect(strict).toContain('exactOptionalPropertyTypes');
  expect(overrides.filter((name) => strict.includes(name) && name !== 'noEmit')).toEqual([]);
});

test('the web project is a root reference, and the Node projects leave src/web to it', () => {
  expect(readTsconfig('tsconfig.json').references?.map((reference) => reference.path)).toContain('./tsconfig.web.json');
  expect(readTsconfig('tsconfig.server.test.json').exclude).toContain('src/web/**');
  expect(readTsconfig('tsconfig.server.json').include).not.toContain('src/web/**/*.ts');
});

test('yarn build compiles every project and then builds the app; yarn typecheck is the compile alone', () => {
  expect(SCRIPTS.get('build')).toBe('tsc -b && vite build');
  expect(SCRIPTS.get('typecheck')).toBe('tsc -b');
});

test('yarn dev starts both dev servers through db.ts run app', () => {
  expect(SCRIPTS.get('dev')).toBe('node scripts/dev/db.ts run app -- node scripts/dev/dev.ts');
});

test('yarn type-coverage has an invocation for the web project', () => {
  expect(SCRIPTS.get('type-coverage')).toContain('type-coverage --strict --at-least 100 -p tsconfig.web.json');
});

test('react and react-dom are one exact version', () => {
  const { react, 'react-dom': reactDom } = manifest.dependencies;
  expect(react).toMatch(/^\d+\.\d+\.\d+$/);
  expect(reactDom).toBe(react);
});

test('React Compiler and Babel are not installed: the compiler is off in v0', () => {
  const names = [...Object.keys(manifest.dependencies), ...Object.keys(manifest.devDependencies)];
  expect(names.filter((name) => /babel|react-compiler/.test(name))).toEqual([]);
});

test('the web tooling is a devDependency, and react runs in the app, so Knip strict sees it as a dependency', () => {
  expect(Object.keys(manifest.dependencies)).toEqual(expect.arrayContaining(['react', 'react-dom']));
  expect(Object.keys(manifest.devDependencies)).toEqual(
    expect.arrayContaining([
      '@vitejs/plugin-react',
      'jsdom',
      'msw',
      '@testing-library/react',
      '@testing-library/user-event',
      '@testing-library/jest-dom',
    ]),
  );
});

test('the web Vitest project is jsdom, under src/web, with the setup file; the server project leaves src/web alone', () => {
  expect(webProject.test).toMatchObject({
    name: 'web',
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://localhost/' } },
    include: ['src/web/**/*.test.{ts,tsx}'],
    setupFiles: ['src/web/test-support/vitest.setup.ts'],
  });
  expect(serverProject.test?.exclude).toContain('src/web/**');
  expect(vitestConfig.test?.projects).toEqual([scriptsProject, serverProject, webProject]);
});

test('knip has src/web/main.tsx as a production entry and leaves the test helpers out of production', () => {
  const knip = z
    .object({ entry: z.array(z.string()), project: z.array(z.string()) })
    .parse(JSON.parse(repoText('knip.json')));
  expect(knip.entry).toContain('src/web/main.tsx!');
  expect(knip.project).toContain('src/**/*.{ts,tsx}!');
  expect(knip.project).toContain('!src/web/test-support/**!');
});

test('FTA skips the tests and the test helpers of src/web, and keeps its cap', () => {
  const fta = z
    .object({ score_cap: z.number(), exclude_filenames: z.array(z.string()), exclude_directories: z.array(z.string()) })
    .parse(JSON.parse(repoText('fta.json')));
  expect(fta.score_cap).toBe(50);
  expect(fta.exclude_filenames).toContain('*.test.tsx');
  expect(fta.exclude_directories).toContain('/src/web/test-support');
});
