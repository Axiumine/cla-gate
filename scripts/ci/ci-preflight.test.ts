// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';
import { tempDir } from '../code-caps/test-support.ts';
import { findOnPath, readText, symlink, writeExecutable } from './lib/test-support.ts';

// Runs the preflight step of .github/workflows/ci.yml for real, in bash, against a directory of stub tools.

const ROOT = path.resolve(import.meta.dirname, '../..');
const workflowSchema = z.object({
  jobs: z.record(z.string(), z.object({ steps: z.array(z.object({ run: z.string().optional() })) })),
});
const parsed: unknown = parse(readText(path.join(ROOT, '.github/workflows/ci.yml')));
const jobs = new Map(Object.entries(workflowSchema.parse(parsed).jobs));

function preflight(job: string): string {
  const script = jobs.get(job)?.steps[0]?.run;
  if (script === undefined) {
    throw new Error(`no preflight in job ${job}`);
  }
  return script;
}

const DF_ROOM = (mib: number) =>
  `printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n/dev/x 99999999 1 ${mib * 1024} 1%% /\\n'`;

interface Machine {
  /** Tools to provide as stubs that exit with the given code; a missing key means "not installed". */
  readonly stubs?: Readonly<Record<string, number>>;
  /** Default tools (git, curl, tar) to leave out. */
  readonly without?: readonly string[];
  /** MiB of free space the stub `df` reports. */
  readonly freeMib?: number;
}

/** Runs `script` in bash with a PATH that holds only stubs (and awk, uname, id for the script's own use). */
function run(script: string, machine: Machine) {
  const bin = tempDir();
  const stubs = { git: 0, curl: 0, tar: 0, ...machine.stubs };
  for (const [tool, code] of Object.entries(stubs).filter(([name]) => !(machine.without ?? []).includes(name))) {
    writeExecutable(path.join(bin, tool), `#!/bin/sh\necho "stub ${tool} $*"\nexit ${code}\n`);
  }
  writeExecutable(path.join(bin, 'df'), `#!/bin/sh\n${DF_ROOM(machine.freeMib ?? 10_000)}\n`);
  for (const tool of ['awk', 'uname', 'id']) {
    symlink(findOnPath(tool), path.join(bin, tool));
  }
  const result = spawnSync(findOnPath('bash'), ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
    cwd: bin,
    env: { PATH: bin },
    encoding: 'utf8',
  });
  return { code: result.status, out: result.stdout };
}

test.each([['static'], ['coverage'], ['leaks']])(
  'the %s preflight passes with git, curl, tar and room, and reports the runner',
  (job) => {
    const { code, out } = run(preflight(job), {});
    expect(code).toBe(0);
    expect(out).toMatch(/^runner: Linux \w+, user \w+\n/);
    expect(out).toContain('free space in the workspace: 10000 MiB');
  },
);

test.each([['git'], ['curl'], ['tar']])('a runner without %s fails fast and says so', (tool) => {
  const { code, out } = run(preflight('static'), { without: [tool] });
  expect(code).toBe(1);
  expect(out).toContain(`::error title=Runner preflight::missing on this runner: ${tool} (docs/ci-runners.md`);
});

test('a runner without several tools lists them all', () => {
  const { out } = run(preflight('coverage'), { without: ['git', 'tar'] });
  expect(out).toContain('::error title=Runner preflight::missing on this runner: git tar (');
});

test('a runner short of disk space fails fast and says how much it has', () => {
  const { code, out } = run(preflight('coverage'), { freeMib: 100 });
  expect(code).toBe(1);
  expect(out).toContain('::error title=Runner preflight::only 100 MiB free in the workspace, 4096 needed');
});

test('exactly 4096 MiB is enough', () => {
  expect(run(preflight('static'), { freeMib: 4096 }).code).toBe(0);
});

test.each([['postgres'], ['e2e']])('the %s preflight needs a Docker daemon the runner user can reach', (job) => {
  const missing = run(preflight(job), {});
  expect(missing.code).toBe(1);
  expect(missing.out).toContain('::error title=Runner preflight::the Docker daemon is not reachable by');
  const broken = run(preflight(job), { stubs: { docker: 1 } });
  expect(broken.code).toBe(1);
  expect(broken.out).toContain('the Docker daemon is not reachable');
});

test.each([['postgres'], ['e2e']])('the %s preflight passes with a working daemon and prints its version', (job) => {
  const { code, out } = run(preflight(job), { stubs: { docker: 0 } });
  expect(code).toBe(0);
  expect(out).toContain('docker server stub docker version --format {{.Server.Version}}');
});

test('the semgrep preflight passes with git, curl, tar, python3 and pipx, and needs no Docker', () => {
  const { code, out } = run(preflight('semgrep'), { stubs: { python3: 0, pipx: 0 } });
  expect(code).toBe(0);
  expect(out).toMatch(/^runner: Linux \w+, user \w+\n/);
  expect(out).not.toContain('docker');
});

test.each([['python3'], ['pipx']])('the semgrep preflight fails fast and says so when %s is missing', (tool) => {
  const stubs = tool === 'pipx' ? { python3: 0 } : { pipx: 0 };
  const { code, out } = run(preflight('semgrep'), { stubs });
  expect(code).toBe(1);
  expect(out).toContain(`::error title=Runner preflight::missing on this runner: ${tool} (docs/ci-runners.md`);
});

test('the semgrep preflight lists everything that is missing, and still checks the disk space', () => {
  const stubs = { python3: 0, pipx: 0 };
  expect(run(preflight('semgrep'), { stubs, without: ['git', 'pipx'] }).out).toContain(
    'missing on this runner: git pipx (',
  );
  expect(run(preflight('semgrep'), { stubs, freeMib: 100 }).out).toContain('only 100 MiB free in the workspace');
});

test('the trivy preflight passes with git, curl, tar and sha256sum, and needs no Docker', () => {
  const { code, out } = run(preflight('trivy'), { stubs: { sha256sum: 0 } });
  expect(code).toBe(0);
  expect(out).toMatch(/^runner: Linux \w+, user \w+\n/);
  expect(out).not.toContain('docker');
});

test.each([['git'], ['curl'], ['tar'], ['sha256sum']])(
  'the trivy preflight fails fast and says so when %s is missing',
  (tool) => {
    const { code, out } = run(preflight('trivy'), { stubs: { sha256sum: 0 }, without: [tool] });
    expect(code).toBe(1);
    expect(out).toContain(`::error title=Runner preflight::missing on this runner: ${tool} (docs/ci-runners.md`);
  },
);

test('the trivy preflight lists everything that is missing, and still checks the disk space', () => {
  expect(run(preflight('trivy'), {}).out).toContain('missing on this runner: sha256sum (');
  expect(run(preflight('trivy'), { stubs: { sha256sum: 0 }, without: ['git', 'tar'] }).out).toContain(
    'missing on this runner: git tar (',
  );
  expect(run(preflight('trivy'), { stubs: { sha256sum: 0 }, freeMib: 100 }).out).toContain(
    'only 100 MiB free in the workspace',
  );
});
