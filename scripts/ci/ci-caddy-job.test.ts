// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { ciJob, repoText } from '../semgrep-rules/test-support.ts';
import { expression } from './lib/test-support.ts';

// E19-S05: the `caddy` job of .github/workflows/ci.yml checks docker/Caddyfile with the pinned Caddy image, through the helper
// of scripts/ci/ and nothing else. Its place in the runner policy (docs/ci-runners.md) and the order of its steps are pinned here.

const job = ciJob('caddy');
const ciText = repoText('.github/workflows/ci.yml');
const names = job.steps.map((step) => step.name);

test('the job is named caddy, runs on the shared self-hosted runners and may take 10 minutes', () => {
  expect(job.name).toBe('caddy');
  expect(job['runs-on']).toEqual(['self-hosted', 'Linux', 'X64']);
  expect(job['timeout-minutes']).toBe(10);
});

test('the job is informative: no other job waits for it, and it waits for none, so it cannot hold up a required check', () => {
  expect(job.needs).toBeUndefined();
  expect(ciText).not.toMatch(/needs:.*\bcaddy\b/);
  expect(ciText).not.toMatch(/- caddy$/m);
});

test('the job starts with the preflight (it needs a Docker daemon) and keeps tool state in the runner temp directory', () => {
  expect(names.slice(0, 3)).toEqual([
    'Preflight (runner capabilities)',
    'Keep tool state in the runner temp directory',
    'Check out the repository',
  ]);
  expect(job.steps[0]?.run).toContain('docker info');
});

test('the helper validates, then always removes the container of this run, and nothing else touches Docker', () => {
  const validate = job.steps.findIndex((step) => step.run === 'yarn ci:caddy validate');
  const stop = job.steps.findIndex((step) => step.run === 'yarn ci:caddy stop');
  expect(validate).toBeGreaterThan(names.indexOf('Install dependencies'));
  expect(stop).toBe(validate + 1);
  expect(job.steps.at(stop)?.if).toBe(expression("always() && env.CLA_CADDY_CONTAINER != ''"));
  expect(job.steps.at(validate)?.if).toBeUndefined();
  const runs = job.steps.flatMap((step) => (step.run === undefined ? [] : [step.run])).join('\n');
  expect(runs).not.toMatch(/docker (run|rm|pull|compose|build)/);
});

test('the job has no container, no services, no permissions of its own, no secret and no published port', () => {
  expect(job.permissions).toBeUndefined();
  expect(job.env).toBeUndefined();
  expect(job.steps.filter((step) => step['continue-on-error'] !== undefined || step.env !== undefined)).toEqual([]);
  const text = ciText.slice(ciText.indexOf('\n  caddy:\n'), ciText.indexOf('\n  # The container smoke test'));
  expect(text).not.toMatch(/^ +(container|services|ports):/m);
  expect(text).not.toContain('secrets.');
  expect(text).not.toContain('--publish');
});
