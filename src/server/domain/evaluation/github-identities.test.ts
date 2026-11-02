// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { GITHUB_WEB_FLOW_ID } from './github-identities.ts';

test('the web-flow id is the one GitHub reports for the web-flow account (verified 2026-11-02)', () => {
  expect(GITHUB_WEB_FLOW_ID).toBe(19_864_447);
});

test('the web-flow id is a positive safe integer, like every GitHub id the engine compares', () => {
  expect(Number.isSafeInteger(GITHUB_WEB_FLOW_ID)).toBe(true);
  expect(GITHUB_WEB_FLOW_ID).toBeGreaterThan(0);
});
