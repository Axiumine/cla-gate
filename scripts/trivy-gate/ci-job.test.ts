// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { expression, findOnPath, readText } from '../ci/lib/test-support.ts';
import { tempDir } from '../code-caps/test-support.ts';
import { ciJob, listDir, repoText } from '../semgrep-rules/test-support.ts';
import { yamlOf } from './test-support.ts';
import { compareVersions, parseVersion } from './versions.ts';

// E20-S02: the `trivy` job of .github/workflows/ci.yml, the nightly schedule, and the step that keeps Trivy's cache in
// the runner temp directory, run for real in bash.

const job = ciJob('trivy');
const SCAN = 'Trivy (vulnerabilities, then secrets and misconfiguration)';
const NIGHTLY = 'Trivy (dev dependencies, nightly run only)';
const CACHE_STEP = "Keep Trivy's cache in the runner temp directory";
const INSTALL = 'Install Trivy (pinned, in the runner temp directory)';
const ciText = repoText('.github/workflows/ci.yml');
const jobText = ciText.slice(ciText.indexOf('\n  trivy:\n'));

/** A step of the job by name (the failure names it). */
function step(name: string) {
  const found = job.steps.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`the trivy job has no step ${name}`);
  }
  return found;
}

const workflow = z
  .object({
    on: z
      .object({ pull_request: z.unknown(), push: z.unknown(), schedule: z.array(z.object({ cron: z.string() })) })
      .strict(),
    concurrency: z.object({ group: z.string(), 'cancel-in-progress': z.string() }),
  })
  .parse(yamlOf('.github/workflows/ci.yml'));

const MISE_PIN = /^"aqua:aquasecurity\/trivy" = "([^"]+)"$/m.exec(repoText('mise.toml'))?.[1];

test('the job is named trivy, has no needs, runs on the shared self-hosted runners and has a timeout', () => {
  expect(job.name).toBe('trivy');
  expect(job.needs).toBeUndefined();
  expect(job['runs-on']).toEqual(['self-hosted', 'Linux', 'X64']);
  expect(job['timeout-minutes']).toBeGreaterThan(0);
  expect(job['timeout-minutes']).toBeLessThanOrEqual(20);
});

test('the job asks for no more than contents: read, holds no secret and sets only two harmless Trivy options', () => {
  expect(job.permissions).toBeUndefined();
  expect(job.env).toEqual({ TRIVY_NO_PROGRESS: 'true', TRIVY_SKIP_VERSION_CHECK: 'true' });
  expect(ciText).toMatch(/^permissions:\n {2}contents: read\n/m);
  expect(ciText).not.toMatch(/\$\{\{\s*secrets\./);
  expect(ciText).not.toMatch(/\bGITHUB_TOKEN\b/);
});

test('the steps are the standard Node and Yarn setup, then Trivy, its cache, and the scan, in that order', () => {
  expect(job.steps.map((each) => each.name)).toEqual([
    'Preflight (runner capabilities)',
    'Keep tool state in the runner temp directory',
    'Check out the repository',
    'Set up Node.js (version from .nvmrc)',
    'Enable Corepack',
    'Restore the Yarn cache',
    'Install dependencies',
    INSTALL,
    CACHE_STEP,
    'Restore the Trivy cache (one per calendar day)',
    SCAN,
    NIGHTLY,
  ]);
  expect(step('Install dependencies').run).toBe('yarn install --immutable');
  expect(step('Check out the repository').with).toMatchObject({ 'persist-credentials': false, clean: true });
});

test('yarn trivy runs on every event and cannot fail softly; yarn trivy:dev runs on the schedule only', () => {
  expect(job.if).toBeUndefined();
  expect(job.steps.filter((each) => each['continue-on-error'] !== undefined)).toEqual([]);
  expect(job.steps.filter((each) => each.if !== undefined).map((each) => each.name)).toEqual([NIGHTLY]);
  expect(step(SCAN)).toMatchObject({ run: 'yarn trivy' });
  expect(step(NIGHTLY)).toMatchObject({ run: 'yarn trivy:dev', if: expression("github.event_name == 'schedule'") });
  expect(job.steps.at(-1)?.name).toBe(NIGHTLY);
});

test('Trivy comes from setup-trivy, pinned by full commit SHA to v0.2.6 or later, and trivy-action is not used', () => {
  const install = step(INSTALL);
  expect(install.uses).toMatch(/^aquasecurity\/setup-trivy@[0-9a-f]{40}$/);
  const tag = /aquasecurity\/setup-trivy@[0-9a-f]{40} # (v\d+\.\d+\.\d+)$/m.exec(ciText)?.[1];
  const version = parseVersion(tag ?? '');
  expect(version).toBeDefined();
  expect(compareVersions(version ?? [0, 0, 0], [0, 2, 6])).toBeGreaterThanOrEqual(0);
  expect(job.steps.filter((each) => /trivy-action/i.test(each.uses ?? ''))).toEqual([]);
});

test('setup-trivy installs the exact version of mise.toml into the runner temp directory, with no cache and no token', () => {
  expect(MISE_PIN).toMatch(/^\d+\.\d+\.\d+$/);
  expect(step(INSTALL).with).toEqual({
    version: `v${MISE_PIN}`,
    path: `${expression('runner.temp')}/trivy`,
    cache: false,
  });
});

test('the schedule is a nightly cron on the default branch, next to the existing pull request and push triggers', () => {
  expect(workflow.on.schedule).toEqual([{ cron: '17 3 * * *' }]);
  expect(workflow.on.pull_request).toBeDefined();
  expect(workflow.on.push).toEqual({ branches: ['main'] });
});

test('a queued nightly run is not replaced by a push: the event name is part of the concurrency group', () => {
  expect(workflow.concurrency.group).toBe(`ci-${expression('github.event_name')}-${expression('github.ref')}`);
  expect(workflow.concurrency['cancel-in-progress']).toBe(expression("github.event_name == 'pull_request'"));
});

test('the Trivy cache lives in the runner temp directory and is keyed by calendar day', () => {
  const restore = step('Restore the Trivy cache (one per calendar day)');
  expect(restore.uses).toMatch(/^actions\/cache@[0-9a-f]{40}$/);
  expect(restore.with).toEqual({
    path: `${expression('runner.temp')}/trivy-cache`,
    key: `trivy-${expression('runner.os')}-${expression('steps.day.outputs.day')}`,
    'restore-keys': `trivy-${expression('runner.os')}-`,
  });
  expect(jobText).toContain(`- name: ${CACHE_STEP}\n        id: day\n`);
  expect(jobText).not.toContain('.cache/trivy');
});

/** Runs the cache step in bash the way the runner does, with a temp directory, a home directory and the two files. */
function cacheStep() {
  const temp = tempDir();
  const home = tempDir();
  const files = { env: path.join(temp, 'github-env'), output: path.join(temp, 'github-output') };
  const env = {
    PATH: path.dirname(findOnPath('bash')),
    HOME: home,
    RUNNER_TEMP: temp,
    GITHUB_ENV: files.env,
    GITHUB_OUTPUT: files.output,
  };
  const script = step(CACHE_STEP).run ?? '';
  const before = new Date().toISOString().slice(0, 10);
  const result = spawnSync(findOnPath('bash'), ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
    env,
    encoding: 'utf8',
  });
  const after = new Date().toISOString().slice(0, 10);
  return { temp, home, files, result, days: [before, after] };
}

test('the cache step points TRIVY_CACHE_DIR into the runner temp directory and leaves the home directory empty', () => {
  const { temp, home, files, result } = cacheStep();
  expect(result.status).toBe(0);
  expect(readText(files.env)).toBe(`TRIVY_CACHE_DIR=${temp}/trivy-cache\n`);
  expect(listDir(home)).toEqual([]);
});

test('the cache step publishes today as the UTC calendar day, which is what changes the cache key once a day', () => {
  const { files, days } = cacheStep();
  const output = readText(files.output);
  expect(output).toMatch(/^day=\d{4}-\d{2}-\d{2}\n$/);
  expect(days).toContain(output.slice('day='.length, -1));
});
