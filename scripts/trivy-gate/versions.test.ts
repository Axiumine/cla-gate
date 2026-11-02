// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { compareVersions, compromisedReferences, LAST_COMPROMISED_ACTION, parseVersion } from './versions.ts';

// E20-S02: finding the compromised Trivy releases and trivy-action tags in the text of a file. The fixture lines are
// built from parts so that this file does not itself look like a workflow that installs them.

const ACTION = 'aquasecurity/trivy-action';
const SHA = '0123456789abcdef0123456789abcdef01234567';

test.each([
  ['1.2.3', [1, 2, 3]],
  ['v1.2.3', [1, 2, 3]],
  ['0.34', [0, 34, 0]],
  ['v10.20.30', [10, 20, 30]],
])('parseVersion reads %s', (text, expected) => {
  expect(parseVersion(text)).toEqual(expected);
});

test.each([[''], ['1'], ['1.2.3.4.5'], ['x1.2.3'], ['1.2.3-rc1'], ['latest'], ['^0.76.1'], ['>=0.76.1'], ['0.76.x']])(
  'parseVersion refuses %j: only an exact release counts',
  (text) => {
    expect(parseVersion(text)).toBeUndefined();
  },
);

test('compareVersions orders by major, then minor, then patch', () => {
  expect(compareVersions([0, 76, 1], [0, 76, 1])).toBe(0);
  expect(compareVersions([0, 76, 1], [0, 76, 2])).toBeLessThan(0);
  expect(compareVersions([0, 77, 0], [0, 76, 9])).toBeGreaterThan(0);
  expect(compareVersions([1, 0, 0], [0, 99, 99])).toBeGreaterThan(0);
  expect(compareVersions([0, 34, 2], LAST_COMPROMISED_ACTION)).toBe(0);
});

test.each([
  ['version: v0.69.4'],
  ['version: 0.69.5'],
  ['curl -L https://example.org/trivy_0.69.6_Linux-64bit.tar.gz'],
  ['pinned at 0.69.4.'],
  ['"aqua:aquasecurity/trivy" = "0.69.6"'],
  ['trivy@v0.69.5, then more text'],
])('names a malicious Trivy release: %s', (line) => {
  expect(compromisedReferences(line)).toEqual(['line 1: names a malicious Trivy release (0.69.4 to 0.69.6)']);
});

test.each([
  ['version: v0.69.3'],
  ['version: v0.69.7'],
  ['version: v0.69.40'],
  ['version: v0.69.4.1'],
  ['version: v0.69.50'],
  ['address 10.0.69.4'],
  ['address 100.69.4.2'],
  ['version: v0.76.1'],
  ['version: v0.6.94'],
  ['nothing here'],
  [''],
])('does not name a malicious Trivy release: %j', (line) => {
  expect(compromisedReferences(line)).toEqual([]);
});

test.each([
  [`uses: ${ACTION}@0.0.1`],
  [`uses: ${ACTION}@v0.20.0`],
  [`uses: ${ACTION}@0.34.2`],
  [`uses: ${ACTION}@0.34`],
  [`uses: ${ACTION}@${SHA} # v0.33.1`],
  [`uses: ${ACTION}@${SHA} # 0.30.0`],
  ['  uses: AquaSecurity/Trivy-Action@v0.1.0'],
])('names a trivy-action tag up to 0.34.2: %s', (line) => {
  expect(compromisedReferences(line)).toEqual(['line 1: names a trivy-action tag up to 0.34.2, which was repointed']);
});

test.each([
  [`uses: ${ACTION}@0.34.3`],
  [`uses: ${ACTION}@v0.35.0`],
  [`uses: ${ACTION}@${SHA} # v0.35.0`],
  [`uses: ${ACTION}@${SHA} # v1.0.0`],
  [`uses: ${ACTION}@${SHA}`],
  ['uses: actions/checkout@v0.1.0 # a different action'],
  ['run: echo trivy-action is not used'],
])('does not name a repointed trivy-action tag: %s', (line) => {
  expect(compromisedReferences(line)).toEqual([]);
});

test('every offending line is reported with its own line number, and a line can break both rules', () => {
  const text = ['name: ok', `uses: ${ACTION}@0.1.0`, 'run: true', `uses: ${ACTION}@0.2.0 # trivy 0.69.4`].join('\n');
  expect(compromisedReferences(text)).toEqual([
    'line 2: names a trivy-action tag up to 0.34.2, which was repointed',
    'line 4: names a malicious Trivy release (0.69.4 to 0.69.6)',
    'line 4: names a trivy-action tag up to 0.34.2, which was repointed',
  ]);
});
