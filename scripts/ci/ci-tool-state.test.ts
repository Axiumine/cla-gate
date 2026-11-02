// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { expect, test } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';
import { tempDir } from '../code-caps/test-support.ts';
import { exists, findOnPath, readText, writeExecutable } from './lib/test-support.ts';

// Runs the "Keep tool state" and "Enable Corepack" steps of .github/workflows/ci.yml for real, in bash, against a stub
// npm: the shared runner user's home directory, /tmp and the tool-cache Node must stay untouched.

const ROOT = path.resolve(import.meta.dirname, '../..');
const workflowSchema = z.object({
  jobs: z.record(z.string(), z.object({ steps: z.array(z.object({ name: z.string(), run: z.string().optional() })) })),
});
const parsed: unknown = parse(readText(path.join(ROOT, '.github/workflows/ci.yml')));
const jobs = new Map(Object.entries(workflowSchema.parse(parsed).jobs));

function script(job: string, step: string): string {
  const run = jobs.get(job)?.steps.find((candidate) => candidate.name === step)?.run;
  if (run === undefined) {
    throw new Error(`job ${job} has no step ${step}`);
  }
  return run;
}

/** A runner's temp directory, the two files the runner provides, and a stub npm that records what it was asked to do. */
function runner() {
  const temp = tempDir();
  const bin = tempDir();
  const files = { env: path.join(temp, 'github-env'), path: path.join(temp, 'github-path') };
  const log = path.join(bin, 'calls');
  const template = path.join(bin, 'corepack-template');
  writeExecutable(template, `#!/bin/sh\necho "corepack $*" >> '${log}'\n`);
  const npm = `#!/bin/sh\necho "npm $*" >> '${log}'\nmkdir -p "$4/bin"\ncp '${template}' "$4/bin/corepack"\n`;
  writeExecutable(path.join(bin, 'npm'), npm);
  const env = {
    PATH: `${bin}${path.delimiter}${process.env['PATH'] ?? ''}`,
    RUNNER_TEMP: temp,
    GITHUB_ENV: files.env,
    GITHUB_PATH: files.path,
  };
  const run = (text: string) =>
    spawnSync(findOnPath('bash'), ['--noprofile', '--norc', '-eo', 'pipefail', '-c', text], { env, encoding: 'utf8' });
  return { temp, files, log, run };
}

const JOBS = [['static'], ['coverage'], ['postgres'], ['semgrep'], ['trivy']];

test.each(JOBS)('the %s job sends every tool directory to the runner temp directory', (job) => {
  const { temp, files, run } = runner();
  expect(run(script(job, 'Keep tool state in the runner temp directory')).status).toBe(0);
  expect(readText(files.env).trim().split('\n')).toEqual([
    `COREPACK_HOME=${temp}/corepack`,
    `YARN_GLOBAL_FOLDER=${temp}/yarn`,
    `npm_config_cache=${temp}/npm`,
    `XDG_DATA_HOME=${temp}/xdg-data`,
    `XDG_CACHE_HOME=${temp}/xdg-cache`,
    `TMPDIR=${temp}/tmp`,
  ]);
  expect(exists(path.join(temp, 'tmp'))).toBe(true);
});

test.each(JOBS)('the %s job installs Corepack into a prefix of its own and puts that prefix on the PATH', (job) => {
  const { temp, files, log, run } = runner();
  const result = run(script(job, 'Enable Corepack'));
  expect(result.status).toBe(0);
  const prefix = `${temp}/npm-global`;
  expect(readText(log).trim().split('\n')).toEqual([
    `npm install --global --prefix ${prefix} corepack@0.36.0`,
    `corepack enable --install-directory ${prefix}/bin`,
  ]);
  expect(readText(files.path)).toBe(`${prefix}/bin\n`);
});
