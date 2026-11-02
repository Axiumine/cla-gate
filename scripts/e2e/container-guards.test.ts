// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FullConfig } from '@playwright/test';
import { afterEach, expect, test, vi } from 'vitest';
import globalSetup from '../../e2e/global-setup.ts';
import {
  assertBaselinePolicy,
  isVisualSpec,
  REFUSAL,
  VISUAL_SKIP_REASON,
  visualSkipReason,
} from './container-guards.ts';

const INSIDE = { E2E_CONTAINER: '1' };
const OUTSIDE = {};

test('the refusal says what was refused and where baselines may be written', () => {
  expect(REFUSAL).toBe('Refusing to write visual baselines outside the pinned container');
});

test.each([['all'], ['changed'], ['missing']])('the update mode %s is refused outside the container', (mode) => {
  expect(() => {
    assertBaselinePolicy(mode, OUTSIDE);
  }).toThrow(REFUSAL);
});

test.each([['all'], ['changed'], ['missing'], ['none']])(
  'the update mode %s is allowed inside the container',
  (mode) => {
    expect(() => {
      assertBaselinePolicy(mode, INSIDE);
    }).not.toThrow();
  },
);

test('a run that cannot write baselines is allowed anywhere', () => {
  expect(() => {
    assertBaselinePolicy('none', OUTSIDE);
  }).not.toThrow();
});

test.each([['0'], ['true'], [''], ['2']])('E2E_CONTAINER=%j is not the container', (value) => {
  expect(() => {
    assertBaselinePolicy('all', { E2E_CONTAINER: value });
  }).toThrow(REFUSAL);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

test.each<FullConfig['updateSnapshots']>(['all', 'changed', 'missing'])(
  'the global setup refuses --update-snapshots=%s on the host',
  (mode) => {
    vi.stubEnv('E2E_CONTAINER', undefined);
    expect(() => {
      globalSetup({ updateSnapshots: mode });
    }).toThrow(REFUSAL);
  },
);

test('the global setup lets a host run that writes nothing through', () => {
  vi.stubEnv('E2E_CONTAINER', undefined);
  expect(() => {
    globalSetup({ updateSnapshots: 'none' });
  }).not.toThrow();
});

test('the global setup lets the container write baselines', () => {
  vi.stubEnv('E2E_CONTAINER', '1');
  expect(() => {
    globalSetup({ updateSnapshots: 'all' });
  }).not.toThrow();
});

test.each([
  ['canary.visual.spec.ts', true],
  ['e2e/screens/login.visual.spec.ts', true],
  ['/abs/path/home.visual.spec.tsx', true],
  ['x.visual.spec.mts', true],
  ['x.visual.spec.js', true],
  ['smoke.spec.ts', false],
  ['visual.spec.ts', false],
  ['canary.visual.spec.ts.bak', false],
  ['canary.visual.test.ts', false],
  ['e2e/x.visual.spec.ts/other.spec.ts', false],
])('%s is a visual spec: %s', (file, visual) => {
  expect(isVisualSpec(file)).toBe(visual);
});

test('a visual spec is skipped, with the reason, anywhere but in the container', () => {
  expect(visualSkipReason('a.visual.spec.ts', OUTSIDE)).toBe(VISUAL_SKIP_REASON);
  expect(visualSkipReason('a.visual.spec.ts', INSIDE)).toBeUndefined();
});

test('another spec is never skipped by the guard', () => {
  expect(visualSkipReason('a.spec.ts', OUTSIDE)).toBeUndefined();
  expect(visualSkipReason('a.spec.ts', INSIDE)).toBeUndefined();
});

test('the skip reason names the container and the command', () => {
  expect(VISUAL_SKIP_REASON).toContain('pinned Playwright container');
  expect(VISUAL_SKIP_REASON).toContain('yarn e2e:update');
});
