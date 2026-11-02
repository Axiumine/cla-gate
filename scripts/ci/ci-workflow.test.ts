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

test('the jobs are static, coverage, postgres, semgrep and trivy, and the required ones keep their exact names', () => {
  expect([...jobs.keys()]).toEqual(['static', 'coverage', 'postgres', 'semgrep', 'trivy']);
  expect([...jobs.entries()].map(([id, job]) => [id, job.name])).toEqual([
    ['static', 'static'],
    ['coverage', 'coverage'],
    ['postgres', 'postgres'],
    ['semgrep', 'semgrep'],
    ['trivy', 'trivy'],
  ]);
});

test('every job runs on one and the same allowed runner and has a timeout', () => {
  const runners = new Set([...jobs.values()].map((job) => JSON.stringify(job['runs-on'])));
  expect(runners.size).toBe(1);
  for (const job of [...jobs.values()]) {
    expect(job['timeout-minutes']).toBeGreaterThan(0);
    expect(job['timeout-minutes']).toBeLessThanOrEqual(20);
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
    expect(step.uses).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
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
  expect(suite).toBe(start + 1);
  expect(stop).toBe(suite + 1);
  expect(steps.at(stop)?.if).toBe(expression("always() && env.CLA_PG_CONTAINER != ''"));
});

test('every job starts with the preflight and keeps tool state in the runner temp directory', () => {
  for (const job of [...jobs.values()]) {
    expect(job.steps[0]?.name).toBe('Preflight (runner capabilities)');
    expect(job.steps[1]?.name).toBe('Keep tool state in the runner temp directory');
    expect(job.steps[1]?.run).toContain('COREPACK_HOME=$RUNNER_TEMP/corepack');
    expect(job.steps[1]?.run).toContain('YARN_GLOBAL_FOLDER=$RUNNER_TEMP/yarn');
  }
});

test('only the postgres job needs, and checks for, a Docker daemon', () => {
  for (const [id, job] of [...jobs.entries()]) {
    expect(job.steps[0]?.run?.includes('docker info')).toBe(id === 'postgres');
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
