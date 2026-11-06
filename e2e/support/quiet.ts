// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect } from '@playwright/test';

// E18-S12: the one check every watched page ends with.

/** Fails with the list when a watched page logged a console error, threw, opened a dialog or broke the policy of the page. */
export function expectQuiet(problems: readonly string[]): void {
  expect(problems, `the page misbehaved:\n${problems.join('\n')}`).toEqual([]);
}
