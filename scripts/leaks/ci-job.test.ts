// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { expression, findOnPath, readText, writeExecutable } from '../ci/lib/test-support.ts';
import { tempDir } from '../code-caps/test-support.ts';
import { compareNames } from '../code-caps/types.ts';
import { ciJob, ciTextOnSharedRunners } from '../semgrep-rules/test-support.ts';
import { yamlOf } from '../trivy-gate/test-support.ts';

// E20-S07: the `leaks` job of .github/workflows/ci.yml. Its place in the runner policy (docs/ci-runners.md), the events it
// runs for and the order of its steps are pinned here; the two steps with shell logic run for real in bash against stubs.

const job = ciJob('leaks');
const INSTALL = 'Install Chromium (the one browser, in the runner temp directory)';
const CHECK = 'Check that Chromium starts';
const CONTROL = 'Positive control (the wrapper must fail on a leak, pass on a clean page and report an error)';
const UPLOAD = 'Upload the leak report, traces and heap profiles';

function step(name: string) {
  const found = job.steps.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`the leaks job has no step ${name}`);
  }
  return found;
}

const workflow = z
  .object({
    on: z.object({
      pull_request: z.unknown(),
      push: z.object({ branches: z.array(z.string()), tags: z.array(z.string()) }),
      schedule: z.array(z.object({ cron: z.string() })),
      workflow_dispatch: z.unknown(),
    }),
    jobs: z.object({ leaks: z.record(z.string(), z.unknown()) }),
  })
  .parse(yamlOf('.github/workflows/ci.yml'));

test('the job is named leaks, waits for coverage, runs on the shared self-hosted runners and may take 30 minutes', () => {
  expect(job.name).toBe('leaks');
  expect(job.needs).toBe('coverage');
  expect(job['runs-on']).toEqual(['self-hosted', 'Linux', 'X64']);
  expect(job['timeout-minutes']).toBe(30);
});

test('the workflow also runs for release candidate tags (v*), next to main, the nightly schedule and a manual run', () => {
  expect(workflow.on.push).toEqual({ branches: ['main'], tags: ['v*'] });
  expect(workflow.on.schedule).toEqual([{ cron: '17 3 * * *' }]);
  expect(workflow.on.workflow_dispatch).toBeDefined();
  expect(workflow.on.pull_request).toBeNull();
});

test('the job runs only for the schedule, a manual run and a pushed v* tag, never for a pull request or a branch push', () => {
  expect(job.if).toBe(
    expression(
      "github.event_name == 'schedule' || github.event_name == 'workflow_dispatch' || (github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v'))",
    ),
  );
  const events = [...String(job.if).matchAll(/github\.event_name == '(\w+)'/g)].map((match) => match[1]);
  expect(events).toEqual(['schedule', 'workflow_dispatch', 'push']);
  expect(String(job.if)).not.toContain('pull_request');
});

test('the job has no container, no services, no permissions of its own, no environment and no secret, so rule R7 is met', () => {
  expect(Object.keys(workflow.jobs.leaks).sort(compareNames)).toEqual([
    'if',
    'name',
    'needs',
    'runs-on',
    'steps',
    'timeout-minutes',
  ]);
  expect(job.steps.filter((each) => each['continue-on-error'] !== undefined)).toEqual([]);
  expect(JSON.stringify(job)).not.toMatch(/docker|secrets\./);
  // The qodana job (E20-S08) holds a secret and runs on a GitHub-hosted machine: it is not part of this check.
  expect(ciTextOnSharedRunners()).not.toMatch(/\$\{\{\s*secrets\./);
});

test('the steps are the standard setup, one browser, the control, the scenarios and the upload', () => {
  expect(job.steps.map((each) => each.name)).toEqual([
    'Preflight (runner capabilities)',
    'Keep tool state in the runner temp directory',
    'Check out the repository',
    'Set up Node.js (version from .nvmrc)',
    'Enable Corepack',
    'Restore the Yarn cache',
    'Install dependencies',
    INSTALL,
    CHECK,
    CONTROL,
    'Leak scenarios',
    UPLOAD,
  ]);
  expect(step('Check out the repository').with).toMatchObject({ 'persist-credentials': false, clean: true });
});

test('dependencies install without scripts, so memlab never downloads a second Chromium', () => {
  expect(step('Install dependencies').run).toBe('yarn install --immutable --mode=skip-build');
});

test('the positive control runs before the scenarios, each with its yarn script and nothing spliced into the command', () => {
  expect(step(CONTROL).run).toBe('yarn leaks:control');
  expect(step('Leak scenarios').run).toBe('yarn leaks');
  const names = job.steps.map((each) => each.name);
  expect(names.indexOf(CONTROL)).toBeLessThan(names.indexOf('Leak scenarios'));
  for (const each of job.steps) {
    expect(each.run ?? '').not.toContain('${{');
  }
});

test('the leak report is uploaded when a step fails, for seven days, and holds the traces and any heap profile in reports/leaks', () => {
  const upload = step(UPLOAD);
  expect(upload.uses).toMatch(/^actions\/upload-artifact@[0-9a-f]{40}$/);
  expect(upload.if).toBe(expression('failure()'));
  expect(upload.with).toMatchObject({ name: 'leaks-report', path: 'reports/leaks/', 'retention-days': 7 });
  expect(upload.with?.['if-no-files-found']).toBe('ignore');
});

test('the leaks job needs no tool beyond the common three and no Docker daemon', () => {
  const preflight = job.steps[0]?.run ?? '';
  expect(preflight).toContain('for tool in git curl tar; do');
  expect(preflight).not.toContain('docker');
  expect(preflight).toContain('-lt 4096');
});

/** A runner's temp directory and the file the runner provides for environment variables. */
function runner() {
  const temp = tempDir();
  const bin = tempDir();
  return {
    temp,
    bin,
    githubEnv: path.join(temp, 'github-env'),
    log: path.join(bin, 'calls'),
    run: (text: string, extra: Readonly<Record<string, string>> = {}) =>
      spawnSync(findOnPath('bash'), ['--noprofile', '--norc', '-eo', 'pipefail', '-c', text], {
        env: {
          PATH: `${bin}${path.delimiter}${process.env['PATH'] ?? ''}`,
          RUNNER_TEMP: temp,
          GITHUB_ENV: path.join(temp, 'github-env'),
          ...extra,
        },
        encoding: 'utf8',
      }),
  };
}

test('Chromium is installed once, by Playwright, into the runner temp directory and not the home directory', () => {
  const { temp, bin, githubEnv, log, run } = runner();
  writeExecutable(
    path.join(bin, 'yarn'),
    `#!/bin/sh\necho "yarn $* PLAYWRIGHT_BROWSERS_PATH=$PLAYWRIGHT_BROWSERS_PATH" >> '${log}'\n`,
  );
  const result = run(step(INSTALL).run ?? '');
  expect(result.status).toBe(0);
  const browsers = `${temp}/playwright-browsers`;
  expect(readText(githubEnv)).toBe(`PLAYWRIGHT_BROWSERS_PATH=${browsers}\n`);
  expect(readText(log).trim().split('\n')).toEqual([
    `yarn playwright install --no-shell chromium PLAYWRIGHT_BROWSERS_PATH=${browsers}`,
  ]);
  expect(browsers.startsWith(temp)).toBe(true);
});

test('a failed browser download fails the step', () => {
  const { bin, run } = runner();
  writeExecutable(path.join(bin, 'yarn'), '#!/bin/sh\nexit 1\n');
  expect(run(step(INSTALL).run ?? '').status).toBe(1);
});

/** A `node` that answers the path query with a stub Chromium, which exits with `chromeCode` (and says `output`). */
function withChromium(chromeCode: number, output: string) {
  const setup = runner();
  const chrome = path.join(setup.bin, 'chrome');
  writeExecutable(chrome, `#!/bin/sh\necho "${output}"\nexit ${chromeCode}\n`);
  writeExecutable(path.join(setup.bin, 'node'), `#!/bin/sh\necho "$@" >> '${setup.log}'\necho '${chrome}'\n`);
  return { ...setup, result: setup.run(step(CHECK).run ?? '') };
}

test('a Chromium that starts passes the check, and its version is in the log', () => {
  const { result, log } = withChromium(0, 'Chromium 156.0.0.0');
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Chromium 156.0.0.0');
  expect(readText(log)).toContain("require('@playwright/test').chromium.executablePath()");
});

test('a Chromium that does not start fails the job at once, with an annotation that names the likely cause', () => {
  const { result } = withChromium(127, 'error while loading shared libraries: libnss3.so');
  expect(result.status).toBe(1);
  expect(result.stdout).toContain(
    '::error title=Chromium::the browser Playwright installed does not start on this runner',
  );
  expect(result.stdout).toContain('a system library is probably missing');
});

test('a path to a browser that does not exist fails the check', () => {
  const { bin, run } = runner();
  writeExecutable(path.join(bin, 'node'), '#!/bin/sh\necho "/nonexistent/chrome"\n');
  const result = run(step(CHECK).run ?? '');
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('::error title=Chromium::');
});
