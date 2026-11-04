// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { RUN_VARIABLE, runFilters, runLabels, SMOKE_OWNER, smokeRun, stackNames } from './names.ts';

// E19-S08: every name and label of a smoke stack, and the guard that keeps the clean-up on the resources of its own run.

test('without a name from the workflow the run is made of the run id, the attempt and the random tail', () => {
  expect(smokeRun({ GITHUB_RUN_ID: '123456', GITHUB_RUN_ATTEMPT: '2' }, 'abcd1234')).toBe(
    'cla-smoke-123456-2-abcd1234',
  );
});

test('outside Actions the run is cla-smoke-local and the random tail', () => {
  expect(smokeRun({}, 'abcd1234')).toBe('cla-smoke-local-abcd1234');
});

test('a run id that is not a number is not used', () => {
  expect(smokeRun({ GITHUB_RUN_ID: 'x; rm -rf', GITHUB_RUN_ATTEMPT: '1' }, 'abcd1234')).toBe(
    'cla-smoke-local-abcd1234',
  );
});

test('the name the workflow set wins, unchanged', () => {
  expect(smokeRun({ [RUN_VARIABLE]: 'cla-smoke-987-1', GITHUB_RUN_ID: '5', GITHUB_RUN_ATTEMPT: '5' }, 'abcd1234')).toBe(
    'cla-smoke-987-1',
  );
});

test.each([
  ['another prefix', 'postgres-prod'],
  ['the prefix alone', 'cla-smoke-'],
  ['upper case', 'cla-smoke-RUN'],
  ['a space', 'cla-smoke-1 2'],
  ['a path', 'cla-smoke-../x'],
  ['a leading hyphen', 'cla-smoke--1'],
  ['an underscore', 'cla-smoke-a_b'],
  ['a line break', 'cla-smoke-1\nx'],
  ['more than 40 characters after the prefix', `cla-smoke-${'1'.repeat(41)}`],
])('a name with %s is refused, with a message that does not repeat it', (_label, value) => {
  expect(() => smokeRun({ [RUN_VARIABLE]: value }, 'abcd1234')).toThrow(
    new Error(`${RUN_VARIABLE} must be cla-smoke- followed by lower-case letters, digits and hyphens (at most 40)`),
  );
});

test('the longest run id and attempt that GitHub could produce still make a valid name', () => {
  const env = { GITHUB_RUN_ID: '9'.repeat(11), GITHUB_RUN_ATTEMPT: '99' };
  expect(() => stackNames(smokeRun(env, 'abcd1234'), 'boot')).not.toThrow();
});

test('a stack is named for its run and its scenario, and its image carries the project name', () => {
  expect(stackNames('cla-smoke-1-1', 'boot')).toEqual({
    run: 'cla-smoke-1-1',
    project: 'cla-smoke-1-1-boot',
    image: 'cla-gate-smoke:cla-smoke-1-1-boot',
  });
});

test.each([
  ['upper case', 'Boot'],
  ['a hyphen', 'tls-a'],
  ['a leading digit', '1boot'],
  ['nothing', ''],
  ['13 characters', 'abcdefghijklm'],
  ['a slash', 'a/b'],
])('a scenario with %s is refused', (_label, scenario) => {
  expect(() => stackNames('cla-smoke-1-1', scenario)).toThrow('scenario');
});

test('a run that is not a smoke run name is refused when a stack is named', () => {
  expect(() => stackNames('production', 'boot')).toThrow('run (cla-smoke-');
});

test('the labels are the CI job and the run, and the filters select exactly those two', () => {
  expect(SMOKE_OWNER).toEqual({ prefix: 'cla-smoke-', labelKey: 'cla-gate.ci', labelValue: 'container' });
  expect(runLabels('cla-smoke-7-1')).toEqual({ 'cla-gate.ci': 'container', 'cla-gate.run': 'cla-smoke-7-1' });
  expect(runFilters('cla-smoke-7-1')).toEqual([
    '--filter',
    'label=cla-gate.ci=container',
    '--filter',
    'label=cla-gate.run=cla-smoke-7-1',
  ]);
});
