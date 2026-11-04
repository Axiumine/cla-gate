// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { exists, expression, findOnPath, readText, writeExecutable } from '../ci/lib/test-support.ts';
import { git, makeRepo, tempDir } from '../code-caps/test-support.ts';
import { compareNames } from '../code-caps/types.ts';
import { ciJob, ciTextOnSharedRunners, repoText } from '../semgrep-rules/test-support.ts';
import { yamlOf } from '../trivy-gate/test-support.ts';

// E20-S06: the `e2e` job of .github/workflows/ci.yml. Its place in the runner policy (docs/ci-runners.md) and the order of its
// steps are pinned here; the step that proves the baselines byte-stable runs for real in bash against a stub yarn.

const job = ciJob('e2e');
const ciText = repoText('.github/workflows/ci.yml');
const BYTE_STABLE = 'Visual baselines are byte-stable (two updates in a row give the same files)';
const STOP_E2E = 'Remove the Playwright container';
const STOP_PG = 'Remove the PostgreSQL container';

function step(name: string) {
  const found = job.steps.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`the e2e job has no step ${name}`);
  }
  return found;
}

const rawJob = z
  .record(z.string(), z.unknown())
  .parse(z.object({ jobs: z.object({ e2e: z.unknown() }) }).parse(yamlOf('.github/workflows/ci.yml')).jobs.e2e);

test('the job is named e2e, waits for static, runs on the shared self-hosted runners and may take 20 minutes', () => {
  expect(job.name).toBe('e2e');
  expect(job.needs).toBe('static');
  expect(job['runs-on']).toEqual(['self-hosted', 'Linux', 'X64']);
  expect(job['timeout-minutes']).toBe(20);
});

test('the job has no container, no services, no permissions of its own and no condition, so rule R7 is met and it cannot be skipped', () => {
  expect(Object.keys(rawJob).sort(compareNames)).toEqual([
    'env',
    'name',
    'needs',
    'runs-on',
    'steps',
    'timeout-minutes',
  ]);
  expect(ciText).not.toMatch(/^ {4,}container:/m);
  expect(job.steps.filter((each) => each['continue-on-error'] !== undefined)).toEqual([]);
});

test('the only job variable is the pinned image, and nothing in the workflow reads a secret', () => {
  expect(Object.keys(z.record(z.string(), z.unknown()).parse(job.env))).toEqual(['E2E_IMAGE']);
  // The qodana job (E20-S08) holds a secret and runs on a GitHub-hosted machine: it is not part of this check.
  expect(ciTextOnSharedRunners()).not.toMatch(/\$\{\{\s*secrets\./);
});

test('the steps are the standard setup, the build, both containers, the tests, the stability check, the upload and the cleanup', () => {
  expect(job.steps.map((each) => each.name)).toEqual([
    'Preflight (runner capabilities)',
    'Keep tool state in the runner temp directory',
    'Check out the repository',
    'Set up Node.js (version from .nvmrc)',
    'Enable Corepack',
    'Restore the Yarn cache',
    'Install dependencies',
    'Build (the server the tests start)',
    'Start PostgreSQL 18 (random free loopback port)',
    'Migrate the database',
    'Playwright tests in the pinned container',
    BYTE_STABLE,
    'Upload the Playwright report and traces',
    STOP_E2E,
    STOP_PG,
  ]);
});

test('dependencies install without scripts, the server is built, the database is started and migrated, then the tests run in the image', () => {
  expect(step('Install dependencies').run).toBe('yarn install --immutable --mode=skip-build');
  expect(step('Build (the server the tests start)').run).toBe('yarn build');
  expect(step('Start PostgreSQL 18 (random free loopback port)').run).toBe('yarn ci:postgres start');
  expect(step('Migrate the database').run).toBe('yarn db:migrate');
  expect(step('Migrate the database').env).toEqual({ MIGRATION_DATABASE_URL: expression('env.DATABASE_URL') });
  expect(step('Playwright tests in the pinned container').run).toBe('yarn ci:e2e run yarn e2e');
  expect(step('Check out the repository').with).toMatchObject({ 'persist-credentials': false, clean: true });
});

test('no run step splices an expression into its command', () => {
  for (const each of job.steps) {
    expect(each.run ?? '').not.toContain('${{');
  }
});

test('both containers are removed by steps that run even when the job fails, once their name was exported', () => {
  expect(step(STOP_E2E).run).toBe('yarn ci:e2e stop');
  expect(step(STOP_E2E).if).toBe(expression("always() && env.CLA_E2E_CONTAINER != ''"));
  expect(step(STOP_PG).run).toBe('yarn ci:postgres stop');
  expect(step(STOP_PG).if).toBe(expression("always() && env.CLA_PG_CONTAINER != ''"));
  const names = job.steps.map((each) => each.name);
  expect(names.indexOf(STOP_E2E)).toBeLessThan(names.indexOf(STOP_PG));
});

test('the report and the traces are uploaded when a step fails, for seven days', () => {
  const upload = step('Upload the Playwright report and traces');
  expect(upload.uses).toMatch(/^actions\/upload-artifact@[0-9a-f]{40}$/);
  expect(upload.if).toBe(expression('failure()'));
  expect(upload.with).toMatchObject({ name: 'playwright-report', 'retention-days': 7 });
  expect(String(upload.with?.['path']).split('\n').filter(Boolean)).toEqual(['playwright-report/', 'test-results/']);
});

test('the e2e job needs no tool beyond the common three and a Docker daemon', () => {
  const preflight = job.steps[0]?.run ?? '';
  expect(preflight).toContain('for tool in git curl tar; do');
  expect(preflight).toContain('docker info');
  expect(preflight).toContain('-lt 4096');
});

/**
 * Runs the stability step in a scratch git workspace whose committed baseline holds `committed` (`undefined`: no
 * baseline is committed); the n-th stubbed `yarn` call writes `outputs[n]` as the one baseline file.
 */
function stabilityRun(outputs: readonly string[], committed?: string) {
  const workspace = tempDir();
  const bin = tempDir();
  const calls = path.join(bin, 'calls');
  const writes = outputs.map((text) => `'${text}'`).join(' ');
  const script = [
    '#!/bin/bash',
    `echo "yarn $*" >> '${calls}'`,
    `n=$(wc -l < '${calls}')`,
    'mkdir -p e2e/__screenshots__',
    `set -- ${writes}`,
    'shift $((n - 1)) 2>/dev/null || set --',
    `if [ $# -gt 0 ]; then printf '%s' "$1" > 'e2e/__screenshots__/canary.png'; fi`,
    'exit 0',
  ].join('\n');
  writeExecutable(path.join(bin, 'yarn'), script);
  git(workspace, 'init', '-q');
  if (committed !== undefined) {
    makeRepo(workspace, { 'e2e/__screenshots__/canary.png': committed });
    git(workspace, 'add', '.');
    git(workspace, '-c', 'user.name=t', '-c', 'user.email=t@example.org', 'commit', '-q', '-m', 'baseline');
  }
  const result = spawnSync(findOnPath('bash'), ['--noprofile', '--norc', '-e', '-c', step(BYTE_STABLE).run ?? ''], {
    cwd: workspace,
    env: { PATH: `${bin}${path.delimiter}${process.env['PATH'] ?? ''}` },
    encoding: 'utf8',
  });
  const log = exists(calls) ? readText(calls).trim().split('\n') : [];
  return { code: result.status, out: result.stdout, calls: log };
}

test('two updates that write the same bytes pass, and both go through the container helper with --update-snapshots=all', () => {
  const { code, out, calls } = stabilityRun(['png-bytes', 'png-bytes'], 'png-bytes');
  expect(code).toBe(0);
  expect(out).toContain('byte-stable: 1 baseline file(s) identical after the second update and equal to the committed');
  expect(calls).toEqual([
    'yarn ci:e2e run yarn e2e --update-snapshots=all',
    'yarn ci:e2e run yarn e2e --update-snapshots=all',
  ]);
});

test('two updates that write different bytes fail with an annotation', () => {
  const { code, out } = stabilityRun(['first-bytes', 'second-bytes'], 'first-bytes');
  expect(code).toBe(1);
  expect(out).toContain('::error title=Visual baselines::two update runs in a row wrote different files');
});

test('two updates that agree with each other but not with the committed baseline fail: the baseline was not written by this image', () => {
  const { code, out } = stabilityRun(['new-render', 'new-render'], 'old-render');
  expect(code).toBe(1);
  expect(out).toContain('M e2e/__screenshots__/canary.png');
  expect(out).toContain('::error title=Visual baselines::the update runs left files under e2e/__screenshots__');
});

test('two updates that write a baseline nobody committed fail instead of passing as stable', () => {
  const { code, out } = stabilityRun(['png-bytes', 'png-bytes']);
  expect(code).toBe(1);
  expect(out).toContain('?? e2e/__screenshots__/canary.png');
  expect(out).toContain('::error title=Visual baselines::the update runs left files under e2e/__screenshots__');
});

test('a run that finds no baseline file fails instead of calling nothing stable', () => {
  const { code, out } = stabilityRun([]);
  expect(code).toBe(1);
  expect(out).toContain('::error title=Visual baselines::no baseline file found under e2e/__screenshots__');
});
