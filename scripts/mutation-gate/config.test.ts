// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { z } from 'zod';
import vitestConfig from '../../vitest.config.ts';
import { scriptsProject, serverProject } from '../../vitest.projects.ts';
import vitestStrykerConfig from '../../vitest.stryker.config.ts';
import { exists } from '../ci/lib/test-support.ts';
import { activeLines, ROOT, repoText, SCRIPTS, workflows } from '../semgrep-rules/test-support.ts';
import { compareVersions, parseVersion } from '../trivy-gate/versions.ts';

// E20-S04: the Stryker packages, stryker.config.mjs, the Vitest config it points at, and the places a debug log level or a
// mutation run in a git hook could slip in. The config is imported and its values are checked, not read as text.

// The config is plain JavaScript outside this project, so a literal import would have no types.
// eslint-disable-next-line no-unsanitized/method -- the specifier is built from this repository's own root directory and a fixed file name
const loaded: unknown = await import(pathToFileURL(path.join(ROOT, 'stryker.config.mjs')).href);
const strykerSchema = z
  .object({
    testRunner: z.string(),
    vitest: z.object({ configFile: z.string() }).strict(),
    checkers: z.array(z.string()),
    tsconfigFile: z.string(),
    coverageAnalysis: z.string(),
    mutate: z.array(z.string()),
    thresholds: z.object({ high: z.number(), low: z.number(), break: z.number() }).strict(),
    incremental: z.boolean(),
    incrementalFile: z.string(),
    tempDirName: z.string(),
    reporters: z.array(z.string()),
    htmlReporter: z.object({ fileName: z.string() }).strict(),
    jsonReporter: z.object({ fileName: z.string() }).strict(),
    clearTextReporter: z.object({ logTests: z.boolean() }).strict(),
  })
  .strict();
const strykerConfig = strykerSchema.parse(z.object({ default: z.unknown() }).parse(loaded).default);

const manifest = z
  .object({ scripts: z.record(z.string(), z.string()), devDependencies: z.record(z.string(), z.string()) })
  .parse(JSON.parse(repoText('package.json')));
// `api` supplies the PartialStrykerOptions type that stryker.config.mjs names in its JSDoc (Knip: an unlisted dependency otherwise).
const PACKAGES = [
  '@stryker-mutator/core',
  '@stryker-mutator/vitest-runner',
  '@stryker-mutator/typescript-checker',
  '@stryker-mutator/api',
];

test('the Stryker packages are devDependencies pinned to the same exact version, 10.1.0 or later', () => {
  const versions = PACKAGES.map((name) => new Map(Object.entries(manifest.devDependencies)).get(name));
  expect(new Set(versions).size).toBe(1);
  const [version] = versions;
  expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  expect(compareVersions(parseVersion(version ?? '') ?? [0, 0, 0], [10, 1, 0])).toBeGreaterThanOrEqual(0);
});

test('yarn mutate is stryker run --incremental', () => {
  expect(SCRIPTS.get('mutate')).toBe('stryker run --incremental');
});

test('the Stryker config selects the Vitest runner, the TypeScript checker, the server project and per-test coverage', () => {
  expect(strykerConfig).toMatchObject({
    testRunner: 'vitest',
    checkers: ['typescript'],
    tsconfigFile: 'tsconfig.server.json',
    coverageAnalysis: 'perTest',
    vitest: { configFile: 'vitest.stryker.config.ts' },
  });
  expect(exists(path.join(ROOT, strykerConfig.vitest.configFile))).toBe(true);
  const tsconfig = z.object({ include: z.array(z.string()) }).parse(JSON.parse(repoText(strykerConfig.tsconfigFile)));
  expect(tsconfig.include).toEqual(['src/server/**/*.ts', 'src/shared/**/*.ts']);
});

test('the thresholds are 95, 90 and a break at 90, which is never lowered', () => {
  expect(strykerConfig.thresholds).toEqual({ high: 95, low: 90, break: 90 });
});

test('the run is incremental, its file and the temporary directory are git-ignored, and the reports are named', () => {
  expect(strykerConfig).toMatchObject({
    incremental: true,
    incrementalFile: 'reports/stryker-incremental.json',
    tempDirName: '.stryker-tmp',
    reporters: ['clear-text', 'html', 'json'],
    htmlReporter: { fileName: 'reports/mutation/index.html' },
  });
  const ignored = repoText('.gitignore').split('\n');
  expect(ignored).toContain('reports/');
  expect(ignored).toContain(`${strykerConfig.tempDirName}/`);
});

/** Every file below `directory`, relative to the repository root, with forward slashes. */
function filesBelow(directory: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: a directory of the repository
  const entries = fs.readdirSync(path.join(ROOT, directory), { withFileTypes: true });
  return entries.flatMap((entry) =>
    entry.isDirectory() ? filesBelow(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`],
  );
}

/** What the `mutate` patterns select: the positive globs, minus every file a `!` glob matches. */
function mutated(patterns: readonly string[]): string[] {
  const all = ['src/server', 'src/shared'].flatMap(filesBelow);
  const include = patterns.filter((pattern) => !pattern.startsWith('!'));
  const exclude = patterns.filter((pattern) => pattern.startsWith('!')).map((pattern) => pattern.slice(1));
  return all.filter(
    (file) =>
      include.some((pattern) => path.matchesGlob(file, pattern)) &&
      !exclude.some((pattern) => path.matchesGlob(file, pattern)),
  );
}

test('the mutated files are all server and shared code except tests, test-support and global-setup files', () => {
  const selected = mutated(strykerConfig.mutate);
  const wanted = ['src/server', 'src/shared']
    .flatMap(filesBelow)
    .filter((file) => file.endsWith('.ts'))
    .filter((file) => !/(?:\.test\.ts|\/test-support\.ts|\/global-setup\.ts)$/.test(file));
  expect(selected).toEqual(wanted);
  expect(selected).toEqual(expect.arrayContaining(['src/server/app.ts', 'src/shared/errors.ts']));
  expect(selected).toEqual(expect.arrayContaining(['src/server/adapters/db/migrator.ts']));
  expect(selected.filter((file) => /test|global-setup/.test(file))).toEqual([]);
});

test('the Vitest config of the mutation run holds the node server project and nothing else', () => {
  expect(vitestStrykerConfig.test?.projects).toEqual([serverProject]);
  expect(serverProject).toMatchObject({ test: { name: 'server', environment: 'node', include: ['src/**/*.test.ts'] } });
  expect(vitestConfig.test?.projects).toEqual([scriptsProject, serverProject]);
  expect(vitestStrykerConfig.test?.coverage).toBeUndefined();
});

test('the node-config tsconfig project covers every config file this story adds', () => {
  const include = z.object({ include: z.array(z.string()) }).parse(JSON.parse(repoText('tsconfig.node.json'))).include;
  const covered = (file: string) => include.some((pattern) => path.matchesGlob(file, pattern));
  expect(
    ['stryker.config.mjs', 'vitest.stryker.config.ts', 'vitest.config.ts', 'vitest.projects.ts'].filter(covered),
  ).toEqual(['stryker.config.mjs', 'vitest.stryker.config.ts', 'vitest.config.ts', 'vitest.projects.ts']);
});

test('--logLevel debug (it crashes on Vitest 5, Stryker issue 6272) appears in no script, hook, workflow or config', () => {
  const texts = [
    ...SCRIPTS.values(),
    ...activeLines(repoText('lefthook.yml')),
    ...workflows().flatMap((flow) =>
      Object.values(flow.jobs).flatMap((job) => job.steps.map((step) => step.run ?? '')),
    ),
    ...repoText('stryker.config.mjs')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//')),
  ];
  expect(texts.filter((text) => /log-?level/i.test(text) && /debug/i.test(text))).toEqual([]);
  expect(Object.keys(strykerConfig)).not.toContain('logLevel');
});

test('mutation never runs in a git hook', () => {
  expect(activeLines(repoText('lefthook.yml')).filter((line) => /stryker|mutat/i.test(line))).toEqual([]);
});
