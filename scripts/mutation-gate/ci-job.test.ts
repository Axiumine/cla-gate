// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { exists, expression, findOnPath, readText, writeExecutable } from '../ci/lib/test-support.ts';
import { tempDir } from '../code-caps/test-support.ts';
import { ciJob, ciTextOnSharedRunners, repoText } from '../semgrep-rules/test-support.ts';
import { yamlOf } from '../trivy-gate/test-support.ts';

// E20-S04 and E20-S05: the `mutation` job of .github/workflows/ci.yml with its two scopes (server and shared code, then the
// scripts scope), the manual trigger, and the steps that decide on --force run for real in bash against a stub yarn.

const job = ciJob('mutation');
const CACHE = 'Restore the Stryker incremental file';
const SCRIPTS_CACHE = 'Restore the Stryker incremental file (scripts scope)';
const RUN = 'Mutation tests';
const SCRIPTS_RUN = 'Mutation tests (scripts scope)';
const UPLOAD = 'Upload the mutation report';
const ciText = repoText('.github/workflows/ci.yml');

/** A step of the job by name (the failure names it). */
function step(name: string) {
  const found = job.steps.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`the mutation job has no step ${name}`);
  }
  return found;
}

const workflow = z
  .object({
    on: z.object({
      workflow_dispatch: z.object({
        inputs: z.object({ force: z.object({ type: z.string(), default: z.boolean(), description: z.string() }) }),
      }),
      schedule: z.array(z.object({ cron: z.string() })),
    }),
  })
  .parse(yamlOf('.github/workflows/ci.yml'));

/** The files that `hashFiles(...)` of a cache key lists. */
function hashedFiles(key: string): string[] {
  const list = /hashFiles\(([^)]*)\)/.exec(key)?.[1] ?? '';
  return [...list.matchAll(/'([^']+)'/g)].map((match) => match[1] ?? '');
}

test('the job is named mutation, waits for static, runs on the shared self-hosted runners and may take 45 minutes', () => {
  expect(job.name).toBe('mutation');
  expect(job.needs).toBe('static');
  expect(job['runs-on']).toEqual(['self-hosted', 'Linux', 'X64']);
  expect(job['timeout-minutes']).toBe(45);
});

test('the job asks for no more than contents: read, holds no secret, stays off pull requests until it has a green run and cannot fail softly', () => {
  expect(job.permissions).toBeUndefined();
  expect(job.env).toBeUndefined();
  // Not on pull requests (docs/epics/E20.md, E20-S04 Open line); every other event runs it.
  expect(job.if).toContain("github.event_name != 'pull_request'");
  expect(job.steps.filter((each) => each['continue-on-error'] !== undefined)).toEqual([]);
  expect(ciText).toMatch(/^permissions:\n {2}contents: read\n/m);
  // The qodana job (E20-S08) holds a secret and runs on a GitHub-hosted machine: it is not part of this check.
  expect(ciTextOnSharedRunners()).not.toMatch(/\$\{\{\s*secrets\./);
});

test('the steps are the standard Node and Yarn setup, the two caches, the two runs and the upload, in that order', () => {
  expect(job.steps.map((each) => each.name)).toEqual([
    'Preflight (runner capabilities)',
    'Keep tool state in the runner temp directory',
    'Check out the repository',
    'Set up Node.js (version from .nvmrc)',
    'Enable Corepack',
    'Restore the Yarn cache',
    'Install dependencies',
    CACHE,
    SCRIPTS_CACHE,
    RUN,
    SCRIPTS_RUN,
    UPLOAD,
  ]);
  expect(step('Install dependencies').run).toBe('yarn install --immutable');
  expect(step('Check out the repository').with).toMatchObject({ 'persist-credentials': false, clean: true });
});

test('the incremental file comes from a cache keyed by the lockfile, Node and both configs, and restored by that prefix', () => {
  const restore = step(CACHE);
  expect(restore.uses).toMatch(/^actions\/cache@[0-9a-f]{40}$/);
  const key = z.string().parse(restore.with?.['key']);
  const prefix = `stryker-${expression('runner.os')}-${expression(
    `hashFiles(${hashedFiles(key)
      .map((file) => `'${file}'`)
      .join(', ')})`,
  )}-`;
  expect(restore.with).toEqual({
    path: 'reports/stryker-incremental.json',
    key: `${prefix}${expression('github.sha')}`,
    'restore-keys': prefix,
  });
  expect(hashedFiles(key)).toEqual(
    expect.arrayContaining(['yarn.lock', '.nvmrc', 'stryker.config.mjs', 'vitest.config.ts']),
  );
});

test('the Vitest files the mutation run reads are part of the cache key too', () => {
  const key = z.string().parse(step(CACHE).with?.['key']);
  expect(hashedFiles(key)).toEqual(expect.arrayContaining(['vitest.projects.ts', 'vitest.stryker.config.ts']));
});

test('the TypeScript projects the checker reads are part of the key: a tsconfig change alters which mutants fail to compile', () => {
  const key = z.string().parse(step(CACHE).with?.['key']);
  expect(hashedFiles(key)).toEqual(expect.arrayContaining(['tsconfig.base.json', 'tsconfig.server.json']));
});

/** A file name as `hashFiles` takes it: in single quotes. */
function quoted(file: string): string {
  return `'${file}'`;
}

/** The cache key (or the `restore-keys` prefix) of the scripts scope for a hash of `files`. */
function scriptsPrefix(files: readonly string[]): string {
  const hashed = expression(`hashFiles(${files.map(quoted).join(', ')})`);
  return `stryker-scripts-${expression('runner.os')}-${hashed}-`;
}

test('the scripts scope has its own incremental file and cache, keyed by what makes an old result untrustworthy', () => {
  const restore = step(SCRIPTS_CACHE);
  expect(restore.uses).toBe(step(CACHE).uses);
  const key = z.string().parse(restore.with?.['key']);
  const prefix = scriptsPrefix(hashedFiles(key));
  expect(restore.with).toEqual({
    path: 'reports/stryker-incremental-scripts.json',
    key: `${prefix}${expression('github.sha')}`,
    'restore-keys': prefix,
  });
  expect(hashedFiles(key)).toEqual(
    expect.arrayContaining([
      'yarn.lock',
      '.nvmrc',
      'stryker.config.mjs',
      'vitest.config.ts',
      'vitest.projects.ts',
      'vitest.stryker-scripts.config.ts',
      'tsconfig.base.json',
      'tsconfig.scripts.json',
    ]),
  );
});

test('the two caches share no file and no key prefix, so neither scope restores the result of the other', () => {
  const server = step(CACHE).with;
  const scripts = step(SCRIPTS_CACHE).with;
  expect(scripts?.['path']).not.toBe(server?.['path']);
  expect(z.string().parse(scripts?.['key']).startsWith(z.string().parse(server?.['restore-keys']))).toBe(false);
  expect(z.string().parse(server?.['key']).startsWith(z.string().parse(scripts?.['restore-keys']))).toBe(false);
});

test('a manual run has a boolean force input that defaults to false, and the nightly schedule exists', () => {
  expect(workflow.on.workflow_dispatch.inputs.force).toMatchObject({ type: 'boolean', default: false });
  expect(workflow.on.workflow_dispatch.inputs.force.description).not.toBe('');
  expect(workflow.on.schedule).toEqual([{ cron: '17 3 * * *' }]);
});

test('--force is decided in an environment variable that is true on the schedule and on a forced manual run only', () => {
  const run = step(RUN);
  expect(run.env).toEqual({
    MUTATE_FORCE: expression(
      "github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.force == true)",
    ),
  });
  expect(run.run).not.toContain('${{');
  expect(run.if).toBeUndefined();
});

/** Runs a mutation step in bash with a stub yarn (`body` is its script), and returns the exit status and its calls. */
function mutationStep(force: string, body = 'echo "$@" >> "$0.calls"', name = RUN) {
  const bin = tempDir();
  const yarn = path.join(bin, 'yarn');
  writeExecutable(yarn, `#!/bin/sh\n${body}\n`);
  const script = step(name).run ?? '';
  const result = spawnSync(findOnPath('bash'), ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
    env: { PATH: `${bin}${path.delimiter}${path.dirname(findOnPath('bash'))}`, MUTATE_FORCE: force },
    encoding: 'utf8',
  });
  const calls = `${yarn}.calls`;
  return { status: result.status, commands: exists(calls) ? readText(calls).trim().split('\n') : [] };
}

test('a scheduled or forced run executes yarn mutate --force', () => {
  expect(mutationStep('true')).toEqual({ status: 0, commands: ['mutate --force'] });
});

test.each(['false', ''])(
  'a run that is not forced (%j) executes plain yarn mutate and reuses the incremental file',
  (force) => {
    expect(mutationStep(force)).toEqual({ status: 0, commands: ['mutate'] });
  },
);

test('a failing mutation run fails the step, so a score below the threshold fails the job', () => {
  expect(mutationStep('false', 'exit 1')).toEqual({ status: 1, commands: [] });
});

test('the scripts scope decides on --force the same way, in an environment variable and not in the command', () => {
  const run = step(SCRIPTS_RUN);
  expect(run.env).toEqual(step(RUN).env);
  expect(run.run).not.toContain('${{');
  expect(run.if).toBeUndefined();
});

test('a scheduled or forced run executes yarn mutate:scripts --force', () => {
  expect(mutationStep('true', undefined, SCRIPTS_RUN)).toEqual({ status: 0, commands: ['mutate:scripts --force'] });
});

test.each(['false', ''])('a run that is not forced (%j) executes plain yarn mutate:scripts', (force) => {
  expect(mutationStep(force, undefined, SCRIPTS_RUN)).toEqual({ status: 0, commands: ['mutate:scripts'] });
});

test('a failing scripts-scope run fails its step, so a score below the threshold fails the job', () => {
  expect(mutationStep('false', 'exit 1', SCRIPTS_RUN)).toEqual({ status: 1, commands: [] });
});

test('the scripts scope runs right after the server scope and before the upload, which picks up both reports', () => {
  const names = job.steps.map((each) => each.name);
  expect(names.indexOf(SCRIPTS_RUN)).toBe(names.indexOf(RUN) + 1);
  expect(names.indexOf(SCRIPTS_RUN)).toBeLessThan(names.indexOf(UPLOAD));
  expect(step(UPLOAD).with?.['path']).toBe('reports/mutation/');
});

test('the report is uploaded as mutation-report for seven days, also when an earlier step failed, and it is the last step', () => {
  const upload = step(UPLOAD);
  expect(upload.uses).toMatch(/^actions\/upload-artifact@[0-9a-f]{40}$/);
  expect(upload.if).toBe(expression('always()'));
  expect(upload.with).toEqual({ name: 'mutation-report', path: 'reports/mutation/', 'retention-days': 7 });
  expect(job.steps.at(-1)?.name).toBe(UPLOAD);
});

test('the upload action is pinned by full commit SHA with its version in the comment', () => {
  expect(ciText).toMatch(/uses: actions\/upload-artifact@[0-9a-f]{40} # v\d+\.\d+\.\d+$/m);
});
