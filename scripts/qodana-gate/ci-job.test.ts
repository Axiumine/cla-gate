// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { z } from 'zod';
import { expression } from '../ci/lib/test-support.ts';
import { checkWorkflow } from '../ci/lib/workflow-guard.ts';
import { compareNames } from '../code-caps/types.ts';
import { ciJob, ciTextOnSharedRunners, repoText, withoutQodanaJob } from '../semgrep-rules/test-support.ts';
import { yamlOf } from '../trivy-gate/test-support.ts';

// E20-S08: the `qodana` job of .github/workflows/ci.yml and the lcov upload of the `coverage` job. The job is a required
// check that fails closed: a missing token, a fork pull request or a coverage job that did not pass is red, never skipped.
// The job runs `if: always()` (a job that needs another is skipped when that one fails, and a skipped required check counts
// as a pass) and no step but the SARIF upload is conditional. The steps with shell logic run for real in bash
// (token-gate.test.ts); here are the job's place in the runner policy (docs/ci-runners.md), its steps, its pins and the one
// place where a secret may appear.

const CI_FILE = '.github/workflows/ci.yml';
const job = ciJob('qodana');
const ciText = repoText(CI_FILE);
// The text of the job itself: from its key to the end of the file (the job is the last one).
const jobText = ciText.slice(ciText.indexOf('\n  qodana:\n'));
const GATE = 'Require QODANA_TOKEN (fail closed)';
const COVERAGE = 'Require the coverage job to have passed (fail closed)';
const DOWNLOAD = 'Download the lcov report of the coverage job';
const CHECK = 'Check the lcov report (present, and paths relative to the repository)';
const SCAN = 'Qodana scan';
const UPLOAD = 'Upload the Qodana findings (SARIF)';
const UPLOAD_CONDITION = expression("always() && steps.scan.outcome != 'skipped'");

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

test('the job asks for contents: read and nothing else, runs always() and has no job-level variable', () => {
  expect(job.permissions).toEqual({ contents: 'read' });
  expect(ciText).toMatch(/^permissions:\n {2}contents: read\n/m);
  // A required job that is skipped counts as a pass for branch protection, and a job with `needs` is skipped when the job
  // it needs fails or is cancelled: the one condition the job may have is the one that cannot skip it, the same as the
  // `coverage` job, and scripts/ci-contract requires it (and a step that reads needs.coverage.result).
  expect(job.if).toBe(expression('always()'));
  expect(job.env).toBeUndefined();
});

test('the job has no container, no services and no environment, so rule R7 is met', () => {
  expect(Object.keys(workflow.jobs['qodana'] ?? {}).sort(compareNames)).toEqual([
    'if',
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

test('the steps are the two gates, the standard setup, the download, the lcov check, the scan and the SARIF upload, in that order', () => {
  expect(job.steps.map((each) => each.name)).toEqual([
    GATE,
    COVERAGE,
    'Check out the repository',
    'Set up Node.js (version from .nvmrc)',
    'Enable Corepack',
    'Install dependencies',
    DOWNLOAD,
    CHECK,
    SCAN,
    UPLOAD,
  ]);
  expect(step(SCAN).id).toBe('scan');
  expect(step('Install dependencies').run).toBe('yarn install --immutable --mode=skip-build');
  expect(step('Check out the repository').with).toMatchObject({ 'persist-credentials': false, clean: true });
});

test('fail closed and nothing conditional: the gates come first, only the SARIF upload has an `if`, and nothing fails softly', () => {
  expect(job.steps.slice(0, 2).map((each) => each.name)).toEqual([GATE, COVERAGE]);
  for (const each of job.steps) {
    // The SARIF upload also runs after a failed scan, which is when the findings are wanted, and never when the scan
    // did not run (a gate failed, or an earlier step did). Every other step runs only after the ones before it succeeded.
    expect(each.if).toBe(each.name === UPLOAD ? UPLOAD_CONDITION : undefined);
  }
  expect(job.steps.filter((each) => each['continue-on-error'] !== undefined)).toEqual([]);
  expect(job.steps.filter((each) => (each.run ?? '').includes('${{'))).toEqual([]);
  // The raw text of the job, so that no spelling of a soft failure hides in a key the parser does not model. The job-level
  // `if` is the only one at its indent, and no step reads an output of a gate step any more.
  expect(jobText).not.toContain('continue-on-error');
  expect(jobText).not.toContain('|| true');
  expect(jobText.match(/^ {4}if:.*$/gm)).toEqual([`    if: ${expression('always()')}`]);
  expect(jobText).not.toMatch(/steps\.gate|outputs\.available/);
});

test('the job reads the result of the coverage job it needs, as the contract of the required checks asks', () => {
  expect(step(COVERAGE).env).toEqual({ COVERAGE_RESULT: expression('needs.coverage.result') });
  expect(step(COVERAGE).run).toMatch(/"\$\{COVERAGE_RESULT:-\}" != "success"/);
});

test('the SARIF upload runs only when the scan ran, and then also after its failure, and it only warns for a missing file', () => {
  expect(step(SCAN).id).toBe('scan');
  expect(step(UPLOAD).if).toBe(UPLOAD_CONDITION);
  expect(step(UPLOAD).with).toMatchObject({ 'if-no-files-found': 'warn', name: 'qodana-sarif' });
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

test('the coverage job uploads coverage/lcov.info as coverage-lcov, kept seven days, after the merge of the shard reports', () => {
  const coverage = ciJob('coverage');
  const names = coverage.steps.map((each) => each.name);
  const upload = coverage.steps.find((each) => each.name === 'Upload the lcov report for Qodana');
  expect(names.at(-1)).toBe('Upload the lcov report for Qodana');
  expect(names.at(-2)).toBe('Merge the shard reports and enforce 100% coverage');
  expect(upload?.uses).toMatch(/^actions\/upload-artifact@[0-9a-f]{40}$/);
  expect(upload?.with).toEqual({
    name: 'coverage-lcov',
    path: 'coverage/lcov.info',
    'retention-days': 7,
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
  expect(job.steps.filter((each) => each.env !== undefined).map((each) => each.name)).toEqual([GATE, COVERAGE, SCAN]);
});

test('the jobs on the shared runners never see a secret: ci.yml without the qodana job has none', () => {
  const shared = ciTextOnSharedRunners();
  expect(shared).not.toMatch(/\$\{\{\s*secrets\./);
  expect(shared).not.toContain('\n  qodana:\n');
  for (const id of [
    'static',
    'coverage-shard',
    'coverage',
    'postgres',
    'semgrep',
    'trivy',
    'mutation',
    'e2e',
    'leaks',
  ]) {
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

test('the workflow comment records why the job is GitHub-hosted, and that it is a required check that fails closed', () => {
  const header = ciText.slice(0, ciText.indexOf('\nname: CI'));
  expect(header).toContain('The exception is `qodana`');
  expect(header).toContain('QODANA_TOKEN');
  expect(header).toContain('`static`, `coverage` and `qodana` are the exact job names that branch protection requires');
  expect(header).toContain('required check that fails closed');
  const comment = ciText.slice(ciText.lastIndexOf('# E20-S08: Qodana'), ciText.indexOf('\n  qodana:\n'));
  expect(comment).toContain('one job on a GitHub-hosted runner');
  expect(comment).toContain('a required check that fails closed');
  expect(comment).toContain('a skipped job counts as a pass for a required check');
  expect(comment).toContain('it runs `if: always()` and fails by itself');
  // The old wording said the opposite: an optional check that a missing token skips and leaves green.
  for (const old of ['optional', 'never a required check', 'maintainer-side', 'ends green', 'never blocked']) {
    expect(comment).not.toContain(old);
  }
});

test('qodana.yaml says the same: a required check that fails closed, never skipped', () => {
  const text = repoText('qodana.yaml');
  expect(text).toContain('Qodana is a required check that fails closed');
  expect(text).toContain('never skipped');
  expect(text).not.toMatch(/optional|never a required check|skips itself/);
});
