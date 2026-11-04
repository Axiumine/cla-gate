// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { ciJob, repoText } from '../semgrep-rules/test-support.ts';
import { expression } from './lib/test-support.ts';

// E19-S08: the `container` job of .github/workflows/ci.yml builds the image from the checkout and runs the smoke test of the
// operator stack on the shared runner's Docker daemon. Its place in the runner policy (docs/ci-runners.md), the order of its
// steps and the cleanup that does not depend on the test are pinned here.

const job = ciJob('container');
const ciText = repoText('.github/workflows/ci.yml');
const names = job.steps.map((step) => step.name);
const runs = job.steps.map((step) => step.run);
// The text of the job below its own key.
const text = ciText
  .slice(ciText.indexOf('\n  container:\n') + 1, ciText.indexOf('\n  # Memory leak scenarios'))
  .replace(/^.*\n/, '');

/** How a shell spells a variable in braces, built so that no test string looks like an unfilled template. */
function shellVariable(name: string): string {
  return `\${${name}}`;
}

function indexOfRun(run: string): number {
  return runs.indexOf(run);
}

test('the job is named container, runs on the shared self-hosted runners and may take 15 minutes', () => {
  expect(job.name).toBe('container');
  expect(job['runs-on']).toEqual(['self-hosted', 'Linux', 'X64']);
  expect(job['timeout-minutes']).toBe(15);
});

test('the job is informative: it waits for no job and no job waits for it, so it cannot hold up a required check', () => {
  expect(job.needs).toBeUndefined();
  expect(ciText).not.toMatch(/needs:.*\bcontainer\b/);
  expect(ciText).not.toMatch(/- container$/m);
});

test('the job runs on every pull request and every push to main: no condition keeps it away', () => {
  expect(job.if).toBeUndefined();
  expect(ciText).toMatch(/^on:\n {2}pull_request:\n {2}push:\n {4}branches: \[main\]/m);
});

test('the job starts with the preflight (a Docker daemon and Compose v2) and keeps tool state in the runner temp directory', () => {
  expect(names.slice(0, 3)).toEqual([
    'Preflight (runner capabilities)',
    'Keep tool state in the runner temp directory',
    'Check out the repository',
  ]);
  expect(job.steps[0]?.run).toContain('docker info');
  expect(job.steps[0]?.run).toContain('docker compose version');
});

test('the compose file is checked for the default profile and for tls, after the dependencies and before the test', () => {
  const install = names.indexOf('Install dependencies');
  const defaultProfile = indexOfRun('docker compose config --quiet');
  const tlsProfile = indexOfRun('docker compose --profile tls config --quiet');
  expect(defaultProfile).toBeGreaterThan(install);
  expect(tlsProfile).toBe(defaultProfile + 1);
  expect(tlsProfile).toBeLessThan(indexOfRun('yarn smoke'));
});

test('the run is named from the run id and attempt, before the test starts, through the file the runner provides', () => {
  const step = job.steps.at(indexOfRun('yarn smoke') - 1);
  expect(step?.name).toBe('Name the smoke stacks of this run');
  expect(step?.run).toBe(
    `echo "CLA_SMOKE_RUN=cla-smoke-${shellVariable('GITHUB_RUN_ID')}-${shellVariable('GITHUB_RUN_ATTEMPT')}" >> "$GITHUB_ENV"`,
  );
  expect(step?.run).not.toContain('github.');
});

test('the test runs once, without a condition, and the logs are uploaded only when a step failed', () => {
  expect(runs.filter((run) => run === 'yarn smoke')).toHaveLength(1);
  expect(job.steps.at(indexOfRun('yarn smoke'))?.if).toBeUndefined();
  const upload = job.steps.at(indexOfRun('yarn smoke') + 1);
  expect(upload?.name).toBe('Upload the compose logs');
  expect(upload?.if).toBe(expression('failure()'));
  expect(upload?.uses).toMatch(/^actions\/upload-artifact@[0-9a-f]{40}$/);
  expect(upload?.with).toMatchObject({ name: 'smoke-compose-logs', path: 'reports/smoke/', 'retention-days': 7 });
});

test('the last step removes what a cancelled run left, always, for the run named above', () => {
  const last = job.steps.at(-1);
  expect(last?.run).toBe('yarn ci:smoke stop');
  expect(last?.if).toBe(expression("always() && env.CLA_SMOKE_RUN != ''"));
  expect(names.at(-1)).toBe('Remove the smoke stacks of this run');
});

test('the only docker commands in the job are the two compose checks: the rest goes through the helpers', () => {
  const docker = runs.flatMap((run) => run?.split('\n').filter((line) => /\bdocker\b/.test(line)) ?? []);
  const allowed = ['docker compose config --quiet', 'docker compose --profile tls config --quiet'];
  expect(docker.filter((line) => !allowed.includes(line) && !/^\s*(if|echo)\b/.test(line))).toEqual([]);
  expect(runs.join('\n')).not.toMatch(/docker (run|rm|pull|build|push|login|network|volume)/);
});

test('the job has no container, no services, no permissions, no environment, no secret and no published port', () => {
  expect(job.permissions).toBeUndefined();
  expect(job.env).toBeUndefined();
  expect(job.steps.filter((step) => step['continue-on-error'] !== undefined || step.env !== undefined)).toEqual([]);
  expect(text).not.toMatch(/^ +(container|services|ports):/m);
  expect(text).not.toContain('secrets.');
  expect(text).not.toContain('--publish');
  expect(text).not.toMatch(/\b(80|443|3000|5432):/);
});
