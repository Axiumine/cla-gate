// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';
import { expression, readText } from './lib/test-support.ts';
import { checkWorkflow } from './lib/workflow-guard.ts';

// Pins what docs/ci-runners.md promises about .github/workflows/ci.yml, beyond what the runner guard checks.

const ROOT = path.resolve(import.meta.dirname, '../..');

const stepSchema = z.object({
  name: z.string(),
  uses: z.string().optional(),
  run: z.string().optional(),
  if: z.string().optional(),
  with: z.record(z.string(), z.unknown()).optional(),
});
// The two runners the guard allows (docs/ci-runners.md). The break-glass edit changes the first into the second.
const HOSTED = 'ubuntu-24.04';
const SELF_HOSTED_LINE = 'runs-on: [self-hosted, Linux, X64]';
const runnerSchema = z.union([
  z.literal(HOSTED),
  z.tuple([z.literal('self-hosted'), z.literal('Linux'), z.literal('X64')]),
]);
const jobSchema = z.object({
  name: z.string(),
  'runs-on': runnerSchema,
  'timeout-minutes': z.number(),
  steps: z.array(stepSchema),
  services: z.unknown().optional(),
});
const workflowSchema = z.object({ jobs: z.record(z.string(), jobSchema) });

function readYaml(file: string): unknown {
  const parsed: unknown = parse(readText(path.join(ROOT, file)));
  return parsed;
}

const CI_FILE = '.github/workflows/ci.yml';
// `mutation` is a matrix job (E20-S04): each shard's job may take 180 minutes, the one cap above 60 that the runner guard
// allows (scripts/ci/lib/runner-rules.ts, R4, named by file and job). Every shard repeats Stryker's initial run of the
// whole server suite: 7003 tests took 12 minutes 37 seconds on a development machine on 2026-11-03 and more than the 20
// minutes it was given on a shared runner, and the suite is planned to reach 25 000 tests, which is 120 minutes on a runner
// three times slower, before the mutants; see the comment on the job in ci.yml, stryker.config.mjs and docs/quality-gates.md
// (Testing, Stryker), which have the arithmetic and the measurements. `postgres` runs the whole suite (8181 tests and growing)
// one file at a time on a real server, and the shared runners cancelled it twice at 20 minutes while its tests still passed.
// `coverage` runs the same suite under V8 coverage (4 to 11 minutes, cancelled once at 15 on a busy runner).
const LONG_JOBS = new Map([
  ['mutation', 180],
  ['postgres', 45],
  ['coverage', 30],
  ['leaks', 30],
  ['qodana', 30],
]);
// E20-S08: the one job that holds a secret (QODANA_TOKEN) runs on a GitHub-hosted machine; see scripts/qodana-gate.
const GITHUB_HOSTED_JOBS = ['qodana'];
const sharedJobs = () => [...jobs.entries()].filter(([id]) => !GITHUB_HOSTED_JOBS.includes(id));
const ciText = readText(path.join(ROOT, CI_FILE));
const jobs = new Map(Object.entries(workflowSchema.parse(readYaml(CI_FILE)).jobs));
const allSteps = [...jobs.values()].flatMap((job) => job.steps);

function jobNamed(id: string) {
  const job = jobs.get(id);
  if (job === undefined) {
    throw new Error(`ci.yml has no job ${id}`);
  }
  return job;
}

test('the jobs are static, coverage, postgres, semgrep, trivy, mutation, e2e, leaks and qodana, and the required ones keep their exact names', () => {
  expect([...jobs.keys()]).toEqual([
    'static',
    'coverage',
    'postgres',
    'semgrep',
    'trivy',
    'mutation',
    'e2e',
    'leaks',
    'qodana',
  ]);
  expect([...jobs.entries()].map(([id, job]) => [id, job.name])).toEqual([
    ['static', 'static'],
    ['coverage', 'coverage'],
    ['postgres', 'postgres'],
    ['semgrep', 'semgrep'],
    ['trivy', 'trivy'],
    ['mutation', `mutation (${expression('matrix.shard')})`],
    ['e2e', 'e2e'],
    ['leaks', 'leaks'],
    ['qodana', 'qodana'],
  ]);
});

test('every job but qodana runs on the shared self-hosted runners, qodana on ubuntu-24.04, and each has a timeout', () => {
  const runners = new Set(sharedJobs().map(([, job]) => JSON.stringify(job['runs-on'])));
  expect([...runners]).toEqual([JSON.stringify(['self-hosted', 'Linux', 'X64'])]);
  expect(GITHUB_HOSTED_JOBS.map((id) => jobNamed(id)['runs-on'])).toEqual([HOSTED]);
  for (const [id, job] of [...jobs.entries()]) {
    expect(job['timeout-minutes']).toBeGreaterThan(0);
    // The mutation shards (E20-S04), the leak scenarios (E20-S07, three browser runs and a download) and Qodana (E20-S08, a
    // 1 GiB linter image) are the long jobs; the guard caps every job at 60, the mutation job at 180 (R4).
    expect(job['timeout-minutes']).toBeLessThanOrEqual(LONG_JOBS.get(id) ?? 20);
  }
});

test('the break-glass edit (every runs-on becomes ubuntu-24.04) still passes the pins and the runner guard', () => {
  // Idempotent on purpose: after the break-glass edit itself, ci.yml already says ubuntu-24.04 and this test must still pass.
  const hosted = ciText.replaceAll(SELF_HOSTED_LINE, `runs-on: ${HOSTED}`);
  const parsed: unknown = parse(hosted);
  const runners = Object.values(workflowSchema.parse(parsed).jobs).map((job) => job['runs-on']);
  expect(runners).toEqual(Array.from({ length: jobs.size }, () => HOSTED));
  expect(checkWorkflow(CI_FILE, parsed)).toEqual([]);
});

test('every third-party action is pinned to a full commit SHA, and every checkout drops its credentials', () => {
  const used = allSteps.flatMap((step) => (step.uses === undefined ? [] : [step]));
  expect(used.length).toBeGreaterThan(0);
  for (const step of used) {
    // `owner/repo@sha`, or `owner/repo/path@sha` for an action inside a repository (actions/cache/restore).
    const [action = '', sha = ''] = (step.uses ?? '').split('@');
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(action.split('/').length).toBeGreaterThanOrEqual(2);
    for (const segment of action.split('/')) {
      expect(segment).toMatch(/^[\w.-]+$/);
    }
  }
  const checkouts = used.filter((step) => step.uses?.startsWith('actions/checkout@'));
  expect(checkouts).toHaveLength(jobs.size);
  for (const step of checkouts) {
    expect(step.with).toMatchObject({ 'persist-credentials': false, clean: true });
  }
});

test('the postgres job has no service container and publishes no port by itself', () => {
  const code = ciText
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
  expect(jobNamed('postgres').services).toBeUndefined();
  expect(code).not.toContain('services:');
  expect(code).not.toContain('ports:');
  expect(code).not.toContain('5432');
});

test('the postgres job starts the helper, then runs the suite, then always removes the container', () => {
  const runs = jobNamed('postgres').steps.map((step) => step.run);
  const start = runs.indexOf('yarn ci:postgres start');
  const suite = runs.indexOf('yarn test');
  const steps = jobNamed('postgres').steps;
  const stop = steps.findIndex((step) => step.run === 'yarn ci:postgres stop');
  expect(start).toBeGreaterThan(0);
  // Between the two sits the server version summary (E20-S03, ci-postgres-job.test.ts).
  expect(suite).toBe(start + 2);
  expect(stop).toBe(suite + 1);
  expect(steps.at(stop)?.if).toBe(expression("always() && env.CLA_PG_CONTAINER != ''"));
});

test('every job on the shared runners starts with the preflight and keeps tool state in the runner temp directory', () => {
  // The qodana job lives on a fresh GitHub-hosted machine that is thrown away after the run: it starts with its own gate.
  for (const [, job] of sharedJobs()) {
    expect(job.steps[0]?.name).toBe('Preflight (runner capabilities)');
    expect(job.steps[1]?.name).toBe('Keep tool state in the runner temp directory');
    expect(job.steps[1]?.run).toContain('COREPACK_HOME=$RUNNER_TEMP/corepack');
    expect(job.steps[1]?.run).toContain('YARN_GLOBAL_FOLDER=$RUNNER_TEMP/yarn');
  }
});

test('only the postgres and e2e jobs need, and check for, a Docker daemon', () => {
  for (const [id, job] of [...jobs.entries()]) {
    expect(job.steps[0]?.run?.includes('docker info')).toBe(id === 'postgres' || id === 'e2e');
  }
});

test('the static job runs the runner guard, with the same script as the pre-push hook', () => {
  expect(jobNamed('static').steps.map((step) => step.run)).toContain('yarn ci:runners');
  const lefthook = z
    .object({
      'pre-push': z.object({
        jobs: z.array(z.object({ group: z.object({ jobs: z.array(z.object({ run: z.string() })) }).optional() })),
      }),
    })
    .parse(readYaml('lefthook.yml'));
  const hookRuns = lefthook['pre-push'].jobs.flatMap((job) => job.group?.jobs.map((inner) => inner.run) ?? []);
  expect(hookRuns).toContain('yarn ci:runners');
  const manifest = z.object({ scripts: z.record(z.string(), z.string()) }).parse(readYaml('package.json'));
  expect(new Map(Object.entries(manifest.scripts)).get('ci:runners')).toBe('node scripts/ci/check-runners.ts');
});
