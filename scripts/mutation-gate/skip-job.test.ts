// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { z } from 'zod';
import { expression, readText } from '../ci/lib/test-support.ts';
import { ciJob, ciTextOnSharedRunners, repoText, workflows } from '../semgrep-rules/test-support.ts';
import { ALWAYS_GATE, GATE } from './test-support.ts';

// E20-S04, "skip when nothing changed": the `mutation` job runs on the nightly schedule, a manual run and a v* tag push, and
// the nightly leg of a shard that already passed on this commit skips itself. This file pins how the job is wired: when it
// runs, what it may read, the `decide` step, and the gate on every step after it, computed from the parsed YAML so that a
// step added later without the gate fails here. The decision itself is tested in skip-decision.test.ts, skip-failures.test.ts
// and skip-cli.test.ts.

const job = ciJob('mutation');
const ciText = repoText('.github/workflows/ci.yml');
const names = job.steps.map((each) => each.name);
const DECIDE = 'Decide whether this shard can be skipped (nightly run only)';
const NODE = 'Set up Node.js (version from .nvmrc)';
const decideIndex = names.indexOf(DECIDE);
const decide = job.steps.at(decideIndex);
const later = job.steps.slice(decideIndex + 1);

test('the job runs for the schedule, a manual run and a pushed v* tag, exactly like the leaks job, and never for a pull request or a push to main', () => {
  expect(job.if).toBe(
    expression(
      "github.event_name == 'schedule' || github.event_name == 'workflow_dispatch' || (github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v'))",
    ),
  );
  expect(job.if).toBe(ciJob('leaks').if);
  expect(String(job.if)).not.toContain('pull_request');
});

test('the job may read the Actions API and the contents of its repository and nothing else, and no other job may read the Actions API', () => {
  expect(job.permissions).toEqual({ actions: 'read', contents: 'read' });
  expect(ciText).toMatch(/^permissions:\n {2}contents: read\n/m);
  const ci = workflows().find((file) => file.name === 'ci.yml');
  const others = Object.entries(ci?.jobs ?? {}).filter(([id]) => id !== 'mutation');
  expect(others.length).toBeGreaterThan(5);
  for (const [id, other] of others) {
    expect(JSON.stringify(other.permissions ?? {}), id).not.toContain('actions');
  }
});

test('the decide step follows Node and runs the script under plain node, before Corepack, Yarn and everything else that needs an install', () => {
  expect(decide?.id).toBe('decide');
  expect(decideIndex).toBe(names.indexOf(NODE) + 1);
  expect(decide?.run).toBe('node scripts/mutation-gate/decide-skip.ts');
  expect(decide?.uses).toBeUndefined();
  expect(decide?.if).toBeUndefined();
  expect(decide?.['continue-on-error']).toBeUndefined();
  for (const before of job.steps.slice(0, decideIndex)) {
    const commands = (before.run ?? '').split('\n').map((line) => line.trimStart());
    expect(
      commands.filter((line) => ['yarn ', 'corepack ', 'npm '].some((tool) => line.startsWith(tool))),
      before.name,
    ).toEqual([]);
  }
});

test('the decide step gets the shard and the job token as environment variables, never in the command, and nothing else', () => {
  expect(decide?.env).toEqual({ STRYKER_SHARD: expression('matrix.shard'), GITHUB_TOKEN: expression('github.token') });
  expect(decide?.run).not.toContain('${{');
  expect(decide?.run).not.toMatch(/token|TOKEN/);
  // The one place on the shared runners that names the token, and the one use of the expression in the file (rule: no
  // secrets on the shared runners; this token is read only, expires with the run and the job never runs for a pull request).
  expect(ciTextOnSharedRunners().split('GITHUB_TOKEN')).toHaveLength(2);
  expect(ciText.split(expression('github.token'))).toHaveLength(2);
});

test('every step after decide carries the gate, and the steps that must also run after a failure carry it with always()', () => {
  expect(later.length).toBeGreaterThan(5);
  for (const each of later) {
    const gate = (each.if ?? '').includes('always()') ? ALWAYS_GATE : GATE;
    expect(each.if, each.name).toBe(gate);
  }
  const always = later.filter((each) => each.if === ALWAYS_GATE).map((each) => each.name);
  expect(always).toEqual([
    'Check the Stryker incremental file before the save',
    'Save the Stryker incremental file',
    'Upload the mutation report',
  ]);
});

test('no step before decide mentions it, and the gate is the only use of its output in the file', () => {
  for (const before of job.steps.slice(0, decideIndex + 1)) {
    expect(JSON.stringify(before), before.name).not.toContain('steps.decide');
  }
  const active = ciText.split('\n').filter((line) => !line.trimStart().startsWith('#'));
  expect(active.filter((line) => line.includes('steps.decide.outputs.skip'))).toHaveLength(later.length);
});

test('the decide script and the package script are one and the same command', () => {
  const manifest = z.object({ scripts: z.record(z.string(), z.string()) }).parse(JSON.parse(readText('package.json')));
  expect(manifest.scripts['mutate:decide']).toBe(decide?.run);
});

test('no document, comment or test still says that the mutation job runs on a push to main', () => {
  const files = [
    '.github/workflows/ci.yml',
    'CHANGELOG.md',
    'docs/ci-runners.md',
    'docs/development.md',
    'docs/epics/E20.md',
    'docs/quality-gates.md',
    'docs/tooling-gotchas.md',
    'docs/toolchain.md',
  ];
  for (const file of files) {
    const text = repoText(file);
    for (const stale of [
      'It runs on pushes to main',
      'runs on pushes to main',
      'on pushes to main, tags',
      'a push to main holds its group',
      'a push to main holds its concurrency group',
      'the push to main after',
    ]) {
      // The Open line of E20-S04 may still name the failed push to main of 2026-11-02 as history.
      if (file === 'docs/epics/E20.md' && stale === 'the push to main after') {
        continue;
      }
      expect(text, `${file}: ${stale}`).not.toContain(stale);
    }
  }
});

test('the documents describe the skip rule where they describe when the mutation job runs', () => {
  for (const file of [
    'docs/ci-runners.md',
    'docs/toolchain.md',
    'docs/quality-gates.md',
    'docs/development.md',
    'docs/epics/E20.md',
    'docs/tooling-gotchas.md',
  ]) {
    expect(repoText(file).toLowerCase(), file).toContain('skip when nothing changed');
  }
  expect(repoText('docs/ci-runners.md')).toContain('`actions: read`');
  expect(repoText('docs/tooling-gotchas.md')).toContain('fails open');
});
