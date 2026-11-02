// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';
import { RULESETS } from './rulesets.ts';
import { activeLines, repoText, SCRIPTS, workflows } from './test-support.ts';

// E20-S01: the Semgrep scripts, the ignore file and the licence rule for the offline copy of the rules.

const SEMGREP_SCRIPT =
  'semgrep scan --config p/typescript --config p/javascript --config p/react --config p/nodejsscan --config p/secrets --error --metrics off --disable-version-check';

test('yarn semgrep is the exact command: five rule sets, any finding fails, no metrics, no version check', () => {
  expect(SCRIPTS.get('semgrep')).toBe(SEMGREP_SCRIPT);
  const configs = [...(SCRIPTS.get('semgrep') ?? '').matchAll(/--config (\S+)/g)].map((match) => match[1]);
  expect(configs).toEqual(RULESETS.map((name) => `p/${name}`));
});

test('yarn semgrep:rules runs the fetch script, and yarn semgrep:offline scans with the saved rules/ directory', () => {
  expect(SCRIPTS.get('semgrep:rules')).toBe('node scripts/fetch-semgrep-rules.ts');
  expect(SCRIPTS.get('semgrep:offline')).toBe(
    'semgrep scan --config rules/ --error --metrics off --disable-version-check',
  );
});

test('semgrep ci is never used, and no command that runs Semgrep excludes a rule or a path or ignores a suppression', () => {
  const runs = workflows().flatMap((flow) =>
    Object.values(flow.jobs).flatMap((job) => job.steps.map((step) => step.run ?? '')),
  );
  const commands = [...SCRIPTS.values(), ...activeLines(repoText('lefthook.yml')), ...runs];
  expect(commands.filter((command) => /\bsemgrep ci\b/.test(command))).toEqual([]);
  const scans = commands.filter((command) => command.startsWith('semgrep scan '));
  expect(scans).toHaveLength(2);
  for (const scan of scans) {
    expect(scan).not.toMatch(/--exclude|--include|--disable-nosem|--severity|--no-git-ignore|--config=?\S*\.ya?ml/);
    expect(scan).toContain('--error');
  }
});

test('.semgrepignore replaces the defaults: dependency, build, output and tool directories, rules/, and nothing else', () => {
  expect(activeLines(repoText('.semgrepignore'))).toEqual([
    'node_modules/',
    '/dist/',
    '/build/',
    '/coverage/',
    '/reports/',
    '/.yarn/',
    '/.stryker-tmp/',
    '/.vitest/',
    '/playwright-report/',
    '/test-results/',
    '/rules/',
  ]);
});

test('.semgrepignore ignores no test file: co-located *.test.ts files are scanned like any other source', () => {
  const patterns = activeLines(repoText('.semgrepignore'));
  expect(patterns.filter((pattern) => /\.test|\.spec|__tests__|^\/?tests?\/$/.test(pattern))).toEqual([]);
  expect(patterns.some((pattern) => pattern.includes('*'))).toBe(false);
});

test('.gitignore keeps rules/ out of the repository: the Semgrep Rules License v1.0 restricts redistribution', () => {
  expect(repoText('.gitignore').split('\n')).toContain('rules/');
});

test('no workflow uploads SARIF, and none uploads or caches rules/ outside the repository', () => {
  const steps = workflows().flatMap((flow) => Object.values(flow.jobs).flatMap((job) => job.steps));
  expect(steps.length).toBeGreaterThan(0);
  const used = steps.flatMap((step) => (step.uses === undefined ? [] : [step.uses]));
  expect(used.filter((action) => /upload-sarif|codeql-action/.test(action))).toEqual([]);
  // E20-S04 uploads the mutation report as an artifact, so an upload is allowed as long as it is not the rules.
  const paths = (action: string) =>
    steps.filter((step) => step.uses?.startsWith(action) === true).map((step) => z.string().parse(step.with?.['path']));
  const uploadPaths = paths('actions/upload-artifact');
  expect(uploadPaths.filter((value) => value.includes('rules'))).toEqual([]);
  const cachePaths = paths('actions/cache');
  expect(cachePaths).not.toEqual([]);
  expect(cachePaths.filter((value) => value.includes('rules'))).toEqual([]);
});

test('the lefthook semgrep job is in the pre-push static-analysis group, runs yarn semgrep, and skips when the binary is absent', () => {
  const jobSchema = z.object({ name: z.string(), run: z.string().optional(), skip: z.array(z.unknown()).optional() });
  const lefthook = z
    .object({
      'pre-commit': z.object({ jobs: z.array(z.unknown()) }),
      'pre-push': z.object({
        jobs: z.array(z.object({ name: z.string(), group: z.object({ jobs: z.array(jobSchema) }).optional() })),
      }),
    })
    .parse(parse(repoText('lefthook.yml')));
  const group = lefthook['pre-push'].jobs.find((job) => job.name === 'static-analysis')?.group;
  const semgrep = group?.jobs.filter((job) => job.name === 'semgrep');
  expect(semgrep).toEqual([
    { name: 'semgrep', run: 'yarn semgrep', skip: [{ run: '! command -v semgrep >/dev/null 2>&1' }] },
  ]);
  expect(JSON.stringify(lefthook['pre-commit'])).not.toContain('semgrep');
});
