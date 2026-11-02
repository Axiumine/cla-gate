// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { z } from 'zod';
import { activeLines, listDir, ROOT, repoText } from '../semgrep-rules/test-support.ts';
import { yamlOf } from '../trivy-gate/test-support.ts';
import { uncommentedExcludes } from './excludes.ts';

// E20-S08: qodana.yaml. The linter is pinned to an exact tag here (the digest is added in the workflow, see ci-job.test.ts),
// the profile is qodana.recommended, and any problem fails the run. There is no baseline file.

const text = repoText('qodana.yaml');

// strictObject: a key nobody planned (a baseline, a second profile, a disabled inspection) fails the parse.
const qodanaYaml = z.strictObject({
  version: z.literal('1.0'),
  linter: z.string(),
  profile: z.strictObject({ name: z.string() }),
  failThreshold: z.number(),
  exclude: z.array(z.unknown()).optional(),
});
const config = qodanaYaml.parse(yamlOf('qodana.yaml'));

test('the file declares version 1.0, the qodana.recommended profile and a fail threshold of zero, and nothing else', () => {
  expect(config.version).toBe('1.0');
  expect(config.profile).toEqual({ name: 'qodana.recommended' });
  expect(config.failThreshold).toBe(0);
});

test('the linter is qodana-js pinned to an exact 2026 tag: no latest, no -eap, no digest here', () => {
  expect(config.linter).toMatch(/^jetbrains\/qodana-js:2026\.\d+$/);
});

test('there is no baseline: no key, no setting and no SARIF file in the repository root', () => {
  expect(activeLines(text).join('\n')).not.toMatch(/baseline/i);
  expect(Object.keys(config)).not.toContain('baseline');
  expect(listDir(ROOT).filter((name) => name.includes('.sarif'))).toEqual([]);
});

test('every exclusion in the file has a comment line above it that says why (none is needed today)', () => {
  expect(uncommentedExcludes(text)).toEqual([]);
  expect(config.exclude ?? []).toEqual([]);
});

test('the file starts with the licence header like every other source file', () => {
  expect(text.split('\n').slice(0, 2)).toEqual([
    '# SPDX-License-Identifier: AGPL-3.0-only',
    '# Copyright (C) 2026 Giovanni Manzoni',
  ]);
});
