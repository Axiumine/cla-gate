// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { isVisualSpec } from './container-guards.ts';

// E20-S06: what every Playwright spec under e2e/ must look like, so that the container guards cannot be bypassed by a
// spec that imports Playwright's own `test`, or by a screenshot comparison in a file that is not a `.visual.spec.ts`.

const IMPORT_SPECIFIER = /from\s+['"]([^'"]+)['"]/g;
const SUPPORT_MODULE = /^(?:\.\/|(?:\.\.\/)+)support\/test\.ts$/;

/** The problems of one spec file (empty when it follows the rules); `file` is only used in the messages. */
export function specProblems(file: string, source: string): string[] {
  const problems: string[] = [];
  if (source.includes('@playwright/test')) {
    problems.push(`${file}: import test and expect from e2e/support/test.ts, never from @playwright/test`);
  }
  const imported = [...source.matchAll(IMPORT_SPECIFIER)].flatMap((match) => match.slice(1));
  if (!imported.some((specifier) => SUPPORT_MODULE.test(specifier))) {
    problems.push(`${file}: does not import test and expect from e2e/support/test.ts`);
  }
  if (source.includes('toHaveScreenshot') && !isVisualSpec(file)) {
    problems.push(`${file}: compares a screenshot, so its name must end in .visual.spec.ts`);
  }
  return problems;
}
