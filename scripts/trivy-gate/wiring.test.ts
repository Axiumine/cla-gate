// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { activeLines, ROOT, repoText, SCRIPTS, workflows } from '../semgrep-rules/test-support.ts';
import { checkTrivyIgnoreFile } from './blame.ts';
import { allCommands, commandsOf, trivyArgs, yamlOf } from './test-support.ts';
import { compareVersions, compromisedReferences, parseVersion } from './versions.ts';

// E20-S02: the three scripts, trivy.yaml, the pinned version and the repository-wide guards.

const FIRST_COMMAND = 'trivy fs --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 .';
const SECOND_COMMAND = 'trivy fs --scanners secret,misconfig --exit-code 1 .';

test('yarn trivy runs the vulnerability pass and then the unfiltered secret and misconfiguration pass', () => {
  expect(commandsOf(SCRIPTS.get('trivy') ?? '')).toEqual([FIRST_COMMAND, SECOND_COMMAND]);
  expect(SCRIPTS.get('trivy')).toBe(`${FIRST_COMMAND} && ${SECOND_COMMAND}`);
});

test('--exit-code 1 is spelled out in every trivy command, because the default is 0', () => {
  for (const name of ['trivy', 'trivy:dev', 'trivy:secrets']) {
    for (const command of commandsOf(SCRIPTS.get(name) ?? '')) {
      expect(trivyArgs(command)).toContain('--exit-code');
      expect(trivyArgs(command)[trivyArgs(command).indexOf('--exit-code') + 1]).toBe('1');
    }
  }
});

test('the second pass has no --severity: that flag also filters secrets', () => {
  expect(trivyArgs(SECOND_COMMAND)).not.toContain('--severity');
  expect(trivyArgs(FIRST_COMMAND)).toEqual(expect.arrayContaining(['--severity', 'HIGH,CRITICAL', '--ignore-unfixed']));
});

test('yarn trivy:dev is the first pass plus --include-dev-deps, and yarn trivy:secrets is the secret scanner alone', () => {
  expect(SCRIPTS.get('trivy:dev')).toBe(FIRST_COMMAND.replace(' .', ' --include-dev-deps .'));
  expect(SCRIPTS.get('trivy:secrets')).toBe('trivy fs --scanners secret --exit-code 1 .');
  expect(SCRIPTS.get('trivy')).not.toContain('--include-dev-deps');
});

test('no trivy command anywhere repeats or changes the file selection: trivy.yaml is the one source', () => {
  const trivy = allCommands().filter((command) => command.startsWith('trivy '));
  expect(trivy).toHaveLength(4);
  for (const command of trivy) {
    expect(command).not.toMatch(
      /--skip-|--ignorefile|--ignore-policy|--config|--file-patterns|--exit-on-eol|--ignored/,
    );
    expect(command.endsWith(' .')).toBe(true);
  }
});

test('trivy.yaml skips the dependency, build, output and tool directories and sets nothing else', () => {
  const config = z
    .object({ scan: z.object({ 'skip-dirs': z.array(z.string()) }).strict() })
    .strict()
    .parse(yamlOf('trivy.yaml'));
  expect(config.scan['skip-dirs']).toEqual([
    '**/node_modules',
    '.yarn',
    'coverage',
    'dist',
    'build',
    'reports',
    '.stryker-tmp',
    '.vitest',
    'playwright-report',
    'test-results',
    'rules',
  ]);
});

test('mise.toml pins Trivy to one exact release, v0.76.1 or later', () => {
  const pin = /^"aqua:aquasecurity\/trivy" = "([^"]+)"$/m.exec(repoText('mise.toml'))?.[1];
  const version = parseVersion(pin ?? '');
  expect(pin).toMatch(/^\d+\.\d+\.\d+$/);
  expect(version).toBeDefined();
  expect(compareVersions(version ?? [0, 0, 0], [0, 76, 1])).toBeGreaterThanOrEqual(0);
});

function filesBelow(directory: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: a directory inside the repository
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(full) : [path.relative(ROOT, full)];
  });
}

const SCANNED = [...filesBelow(path.join(ROOT, '.github')), 'mise.toml', 'lefthook.yml'];

test('the files scanned for compromised releases are every file under .github/, mise.toml and lefthook.yml', () => {
  expect(SCANNED).toEqual(
    expect.arrayContaining(['.github/workflows/ci.yml', '.github/dependabot.yml', 'mise.toml', 'lefthook.yml']),
  );
});

test.each(SCANNED.map((file) => [file]))('%s mentions no compromised Trivy release or trivy-action tag', (file) => {
  expect(compromisedReferences(repoText(file))).toEqual([]);
});

test('trivy-action is not used anywhere: Trivy comes from setup-trivy and yarn trivy', () => {
  const uses = workflows().flatMap((flow) =>
    Object.values(flow.jobs).flatMap((job) =>
      job.steps.flatMap((step) => (step.uses === undefined ? [] : [step.uses])),
    ),
  );
  expect(uses.filter((action) => /trivy/i.test(action))).toEqual([
    expect.stringMatching(/^aquasecurity\/setup-trivy@[0-9a-f]{40}$/),
  ]);
});

test('the repository .trivyignore, when it exists, has a reason and a valid, unexpired expiry on every entry', () => {
  expect(checkTrivyIgnoreFile(ROOT, new Date())).toEqual([]);
});

test('the lefthook jobs named trivy run the right scripts and have no missing-binary skip', () => {
  const job = z.object({ name: z.string(), group: z.object({ jobs: z.array(z.unknown()) }).optional() });
  const hooks = z
    .object({ 'pre-commit': z.object({ jobs: z.array(job) }), 'pre-push': z.object({ jobs: z.array(job) }) })
    .parse(yamlOf('lefthook.yml'));
  const inner = (jobs: readonly z.infer<typeof job>[], group: string) =>
    z.array(z.unknown()).parse(jobs.find((candidate) => candidate.name === group)?.group?.jobs);
  expect(inner(hooks['pre-commit'].jobs, 'staged-checks')).toContainEqual({ name: 'trivy', run: 'yarn trivy:secrets' });
  expect(inner(hooks['pre-push'].jobs, 'static-analysis')).toContainEqual({ name: 'trivy', run: 'yarn trivy' });
  expect(activeLines(repoText('lefthook.yml')).filter((line) => line.includes('trivy'))).toEqual([
    '- name: trivy',
    'run: yarn trivy:secrets',
    '- name: trivy',
    'run: yarn trivy',
  ]);
});
