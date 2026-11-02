// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { z } from 'zod';
import { expression } from '../ci/lib/test-support.ts';
import { checkWorkflow } from '../ci/lib/workflow-guard.ts';
import { compareNames } from '../code-caps/types.ts';
import { ciJob, ciTextOnSharedRunners, repoText, withoutQodanaJob } from '../semgrep-rules/test-support.ts';
import { yamlOf } from '../trivy-gate/test-support.ts';

// E20-S08: the `qodana` job of .github/workflows/ci.yml and the lcov upload of the `coverage` job. The two steps with shell
// logic run for real in bash (token-gate.test.ts); here are the job's place in the runner policy (docs/ci-runners.md), its
// steps, its pins and the one place where a secret may appear.

const CI_FILE = '.github/workflows/ci.yml';
const job = ciJob('qodana');
const ciText = repoText(CI_FILE);
const AVAILABLE = expression("steps.gate.outputs.available == 'true'");
const GATE = 'Check whether Qodana can run (a token, and not a fork pull request)';
const DOWNLOAD = 'Download the lcov report of the coverage job';
const CHECK = 'Check the lcov report (present, and paths relative to the repository)';
const SCAN = 'Qodana scan';
const UPLOAD = 'Upload the Qodana findings (SARIF)';
const ALWAYS_AVAILABLE = expression("always() && steps.gate.outputs.available == 'true'");

function step(name: string) {
  const found = job.steps.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`the qodana job has no step ${name}`);
  }
  return found;
}

const workflow = z.object({ jobs: z.record(z.string(), z.record(z.string(), z.unknown())) }).parse(yamlOf(CI_FILE));
const linter = z.object({ linter: z.string() }).parse(yamlOf('qodana.yaml')).linter;

test('the job is named qodana, waits for coverage, runs on GitHub-hosted ubuntu-24.04 and has a timeout', () => {
  expect(job.name).toBe('qodana');
  expect(job.needs).toBe('coverage');
  expect(job['runs-on']).toBe('ubuntu-24.04');
  expect(job['timeout-minutes']).toBe(30);
});

test('the job asks for contents: read and nothing else, has no condition of its own and no job-level variable', () => {
  expect(job.permissions).toEqual({ contents: 'read' });
  expect(ciText).toMatch(/^permissions:\n {2}contents: read\n/m);
  expect(job.if).toBeUndefined();
  expect(job.env).toBeUndefined();
});

test('the job has no container, no services and no environment, so rule R7 is met', () => {
  expect(Object.keys(workflow.jobs['qodana'] ?? {}).sort(compareNames)).toEqual([
    'name',
    'needs',
    'permissions',
    'runs-on',
    'steps',
    'timeout-minutes',
  ]);
});

test('the runner guard accepts ci.yml as it is: qodana is the only job on a GitHub-hosted runner', () => {
  expect(checkWorkflow(CI_FILE, yamlOf(CI_FILE))).toEqual([]);
  const hosted = Object.entries(workflow.jobs).filter(([, each]) => each['runs-on'] === 'ubuntu-24.04');
  expect(hosted.map(([id]) => id)).toEqual(['qodana']);
});

test('the steps are the gate, the standard setup, the download, the lcov check, the scan and the SARIF upload, in that order', () => {
  expect(job.steps.map((each) => each.name)).toEqual([
    GATE,
    'Check out the repository',
    'Set up Node.js (version from .nvmrc)',
    'Enable Corepack',
    'Install dependencies',
    DOWNLOAD,
    CHECK,
    SCAN,
    UPLOAD,
  ]);
  expect(step(GATE).id).toBe('gate');
  expect(step('Install dependencies').run).toBe('yarn install --immutable --mode=skip-build');
  expect(step('Check out the repository').with).toMatchObject({ 'persist-credentials': false, clean: true });
});

test('every step after the gate is skipped unless the gate said the job can run, and none may fail softly', () => {
  expect(step(GATE).if).toBeUndefined();
  for (const each of job.steps.slice(1)) {
    // The SARIF upload also runs after a failed scan, which is when the findings are wanted.
    expect(each.if).toBe(each.name === UPLOAD ? ALWAYS_AVAILABLE : AVAILABLE);
  }
  expect(job.steps.filter((each) => each['continue-on-error'] !== undefined)).toEqual([]);
  expect(job.steps.filter((each) => (each.run ?? '').includes('${{'))).toEqual([]);
});

test('every action is pinned to a full commit SHA with its version in a comment', () => {
  const used = job.steps.flatMap((each) => (each.uses === undefined ? [] : [each.uses]));
  expect(used.map((each) => each.split('@')[0])).toEqual([
    'actions/checkout',
    'actions/setup-node',
    'actions/download-artifact',
    'JetBrains/qodana-action',
    'actions/upload-artifact',
  ]);
  for (const each of used) {
    expect(each).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  }
  expect(ciText).toMatch(/uses: JetBrains\/qodana-action@[0-9a-f]{40} # v2026\.\d+\.\d+$/m);
  expect(ciText).toMatch(/uses: actions\/download-artifact@[0-9a-f]{40} # v\d+\.\d+\.\d+$/m);
});

test('the scan runs the Qodana action for the whole project: no pull request mode, comment, upload or pushed fix', () => {
  const scan = step(SCAN);
  expect(scan.uses).toMatch(/^JetBrains\/qodana-action@/);
  expect(scan.with).toMatchObject({
    'pr-mode': false,
    'post-pr-comment': false,
    'upload-result': false,
    'push-fixes': 'none',
  });
  expect(scan.with?.['use-annotations']).toBe(false);
});

test('the linter image is the tag of qodana.yaml and also pinned by digest in the workflow', () => {
  const args = String(step(SCAN).with?.['args']);
  expect(args).toMatch(/^--linter jetbrains\/qodana-js:2026\.\d+@sha256:[0-9a-f]{64}$/);
  expect(args.startsWith(`--linter ${linter}@sha256:`)).toBe(true);
});

test('the coverage job uploads coverage/lcov.info as coverage-lcov, kept one day, after the tests', () => {
  const coverage = ciJob('coverage');
  const names = coverage.steps.map((each) => each.name);
  const upload = coverage.steps.find((each) => each.name === 'Upload the lcov report for Qodana');
  expect(names.at(-1)).toBe('Upload the lcov report for Qodana');
  expect(names.at(-2)).toBe('Tests with 100% coverage');
  expect(upload?.uses).toMatch(/^actions\/upload-artifact@[0-9a-f]{40}$/);
  expect(upload?.with).toEqual({
    name: 'coverage-lcov',
    path: 'coverage/lcov.info',
    'retention-days': 1,
    'if-no-files-found': 'error',
  });
  expect(coverage.name).toBe('coverage');
});

test('the qodana job downloads that artifact into .qodana/code-coverage and checks the report there', () => {
  expect(step(DOWNLOAD).with).toEqual({ name: 'coverage-lcov', path: '.qodana/code-coverage' });
  expect(step(CHECK).run).toContain('report=.qodana/code-coverage/lcov.info');
});

test('QODANA_TOKEN is read in two places only, the gate and the scan, and no other secret is used anywhere', () => {
  const uses = [...ciText.matchAll(/\$\{\{ secrets\.(\w+)/g)].map((match) => match[1]);
  expect(uses).toEqual(['QODANA_TOKEN', 'QODANA_TOKEN']);
  expect(step(GATE).env).toEqual({
    HAS_TOKEN: expression("secrets.QODANA_TOKEN != ''"),
    FORK_PR: expression(
      "github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name != github.repository",
    ),
  });
  expect(step(SCAN).env).toEqual({ QODANA_TOKEN: expression('secrets.QODANA_TOKEN') });
  expect(job.steps.filter((each) => each.env !== undefined).map((each) => each.name)).toEqual([GATE, SCAN]);
});

test('the jobs on the shared runners never see a secret: ci.yml without the qodana job has none', () => {
  const shared = ciTextOnSharedRunners();
  expect(shared).not.toMatch(/\$\{\{\s*secrets\./);
  expect(shared).not.toContain('\n  qodana:\n');
  for (const id of ['static', 'coverage', 'postgres', 'semgrep', 'trivy', 'mutation', 'e2e', 'leaks']) {
    expect(shared).toContain(`\n  ${id}:\n`);
  }
});

test('the helper that cuts the job out stops at the next job, or at the end of the file', () => {
  const token = expression('secrets.T');
  const middle = `jobs:\n  a:\n    x: 1\n  qodana:\n    secrets: ${token}\n  # next\n  b:\n    y: 2\n`;
  // The comment lines between the two job keys go with the cut job: they are above the next job, not part of it.
  expect(withoutQodanaJob(middle)).toBe('jobs:\n  a:\n    x: 1\n  b:\n    y: 2\n');
  expect(withoutQodanaJob('jobs:\n  a:\n    x: 1\n  qodana:\n    z: 3\n')).toBe('jobs:\n  a:\n    x: 1');
  expect(withoutQodanaJob('jobs:\n  a:\n    x: 1\n')).toBe('jobs:\n  a:\n    x: 1\n');
});

test('the workflow comment records why the job is GitHub-hosted and that it is never required', () => {
  const header = ciText.slice(0, ciText.indexOf('\nname: CI'));
  expect(header).toContain('The exception is `qodana`');
  expect(header).toContain('QODANA_TOKEN');
  const comment = ciText.slice(ciText.lastIndexOf('# E20-S08: Qodana'), ciText.indexOf('\n  qodana:\n'));
  expect(comment).toContain('one job on a GitHub-hosted runner');
  expect(comment).toContain('maintainer-side check that is never a required check');
});
