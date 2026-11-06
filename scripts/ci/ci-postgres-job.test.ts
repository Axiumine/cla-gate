// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';
import { tempDir } from '../code-caps/test-support.ts';
import { expression, findOnPath, readText, writeExecutable } from './lib/test-support.ts';

// E20-S03: the `postgres` job makes the real-Postgres run trustworthy. It must fail, not skip, when a real-server test
// finds no server (REQUIRE_REAL_POSTGRES=1), must enable the role tests against its own disposable container
// (CLA_ROLE_TESTS=1), and must write the server version to the job summary. No other job may set those variables.

const ROOT = path.resolve(import.meta.dirname, '../..');
const stepSchema = z.object({
  name: z.string(),
  run: z.string().optional(),
  shell: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
});
const workflowSchema = z.object({
  jobs: z.record(
    z.string(),
    z.object({
      steps: z.array(stepSchema),
      env: z.record(z.string(), z.string()).optional(),
      strategy: z.unknown().optional(),
    }),
  ),
});
const ciText = readText(path.join(ROOT, '.github/workflows/ci.yml'));
const parsed: unknown = parse(ciText);
const jobs = new Map(Object.entries(workflowSchema.parse(parsed).jobs));
const steps = jobs.get('postgres')?.steps ?? [];

const STEP_NAMES = steps.map((step) => step.name);
const SUITE = 'Tests against PostgreSQL 18 (this shard)';
const SUMMARY = 'Record the server version in the job summary';

function stepNamed(name: string) {
  const step = steps.find((candidate) => candidate.name === name);
  if (step === undefined) {
    throw new Error(`the postgres job has no step ${name}`);
  }
  return step;
}

test('the suite step runs its shard of the suite, requires a real server and enables the role tests, with the shard index as the only other variable', () => {
  const suite = stepNamed(SUITE);
  expect(suite.run).toBe('yarn test --shard="$SHARD/4"');
  expect(suite.env).toEqual({
    REQUIRE_REAL_POSTGRES: '1',
    CLA_ROLE_TESTS: '1',
    SHARD: expression('matrix.index'),
  });
});

// Two legs on one host at once: each starts its own container through the helper, whose name has a random tail and whose port is
// probed and retried (scripts/ci/lib/postgres-cli.test.ts, "two helpers at once get distinct ports and distinct container
// names"), and the database of the suite is created inside that container. Nothing of the leg is taken from the matrix.
test('the job is a matrix of four shards that fail independently, and no command but the suite reads the matrix', () => {
  const strategy = z
    .object({
      'fail-fast': z.literal(false),
      matrix: z.object({ index: z.tuple([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]) }),
    })
    .parse(jobs.get('postgres')?.strategy);
  expect(strategy.matrix.index).toEqual([1, 2, 3, 4]);
  expect(steps.filter((step) => (step.run ?? '').includes('matrix'))).toEqual([]);
});

test('only the postgres job sets the two variables, in its suite step', () => {
  for (const [id, job] of jobs) {
    const stepEnvs = job.steps.flatMap((step) => Object.keys(step.env ?? {}));
    const names = [...stepEnvs, ...Object.keys(job.env ?? {})].filter(
      (name) => name === 'REQUIRE_REAL_POSTGRES' || name === 'CLA_ROLE_TESTS',
    );
    expect([id, names]).toEqual([id, id === 'postgres' ? ['REQUIRE_REAL_POSTGRES', 'CLA_ROLE_TESTS'] : []]);
  }
  const code = ciText.split('\n').filter((line) => !line.trimStart().startsWith('#'));
  expect(code.filter((line) => line.includes('REQUIRE_REAL_POSTGRES'))).toHaveLength(1);
  expect(code.filter((line) => line.includes('CLA_ROLE_TESTS'))).toHaveLength(1);
});

test('no workflow sets DATABASE_URL itself and no workflow names a fixed database port: only the container of ci:postgres start has one (E19-S10)', () => {
  const names = [...jobs.values()].flatMap((job) => [
    ...Object.keys(job.env ?? {}),
    ...job.steps.flatMap((step) => Object.keys(step.env ?? {})),
  ]);
  expect(names.filter((name) => name === 'DATABASE_URL')).toEqual([]);
  const starters = [...jobs]
    .filter(([, job]) => job.steps.some((step) => step.run === 'yarn ci:postgres start'))
    .map(([id]) => id);
  expect(starters).toEqual(['postgres', 'e2e']);
  const code = ciText.split('\n').filter((line) => !line.trimStart().startsWith('#'));
  expect(code.filter((line) => /\b5432\b/.test(line))).toEqual([]);
});

test('the server version is recorded after the database starts and before the tests, and the container is still removed last', () => {
  const start = STEP_NAMES.indexOf('Start PostgreSQL 18 (random free loopback port)');
  expect(start).toBeGreaterThan(0);
  expect(STEP_NAMES.slice(start, start + 4)).toEqual([
    'Start PostgreSQL 18 (random free loopback port)',
    SUMMARY,
    SUITE,
    'Remove the PostgreSQL container',
  ]);
});

/** Runs the summary step in bash with a stub `docker`, and returns what it printed, what it wrote and the docker call. */
function runSummary(docker: { readonly code: number; readonly stdout: string }) {
  const bin = tempDir();
  const calls = path.join(bin, 'docker-calls');
  const summary = path.join(bin, 'summary.md');
  writeExecutable(
    path.join(bin, 'docker'),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${calls}"\nprintf '%s\\n' '${docker.stdout}'\nexit ${docker.code}\n`,
  );
  const result = spawnSync(
    findOnPath('bash'),
    ['--noprofile', '--norc', '-eo', 'pipefail', '-c', stepNamed(SUMMARY).run ?? ''],
    {
      cwd: bin,
      env: { PATH: `${bin}:/usr/bin:/bin`, CLA_PG_CONTAINER: 'cla-pg-12-1-ab12cd34', GITHUB_STEP_SUMMARY: summary },
      encoding: 'utf8',
    },
  );
  return {
    code: result.status,
    out: result.stdout,
    summary: readIfThere(summary),
    calls: readIfThere(calls),
  };
}

function readIfThere(file: string): string {
  try {
    return readText(file);
  } catch {
    return '';
  }
}

test('the summary step asks the container of this run for select version() and writes it to the job summary', () => {
  const version = 'PostgreSQL 18.6 (stub) on x86_64-pc-linux-gnu';
  const { code, out, summary, calls } = runSummary({ code: 0, stdout: version });
  expect(code).toBe(0);
  expect(out).toBe(`${version}\n`);
  expect(summary).toBe(`### PostgreSQL server\n\n\`\`\`\n${version}\n\`\`\`\n`);
  expect(calls).toBe(
    'exec cla-pg-12-1-ab12cd34 psql --username postgres --no-psqlrc --tuples-only --no-align --command select version()\n',
  );
});

test('the summary step fails the job, and writes nothing, when the container cannot answer', () => {
  const { code, summary } = runSummary({ code: 1, stdout: '' });
  expect(code).not.toBe(0);
  expect(summary).toBe('');
});

test('the summary step uses the container name from the environment and nothing from the event', () => {
  const script = stepNamed(SUMMARY).run ?? '';
  expect(script).toContain('"$CLA_PG_CONTAINER"');
  expect(script).not.toContain('${{');
  expect(stepNamed(SUMMARY).shell).toBe('bash');
});
