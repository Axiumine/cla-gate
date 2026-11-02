// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { readText } from '../ci/lib/test-support.ts';
import { ROOT } from '../semgrep-rules/test-support.ts';
import { specProblems } from './spec-rules.ts';

const GOOD = "import { expect, test } from './support/test.ts';\ntest('x', () => {});\n";
const E2E = path.join(ROOT, 'e2e');

/** Every `*.spec.ts` under e2e/, as a path relative to the repository. */
function specFiles(directory: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a directory inside the repository
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return specFiles(full);
    }
    return entry.name.endsWith('.spec.ts') ? [path.relative(ROOT, full)] : [];
  });
}

test('a spec that imports test and expect from the support module has no problem', () => {
  expect(specProblems('e2e/a.spec.ts', GOOD)).toEqual([]);
});

test('a spec in a subdirectory may import the support module from above', () => {
  expect(specProblems('e2e/s/a.spec.ts', "import { test } from '../support/test.ts';")).toEqual([]);
});

test.each([
  ["import { test } from '@playwright/test';"],
  ['import { test } from "@playwright/test";'],
  ["const { test } = require('@playwright/test');"],
  ["const playwright = await import('@playwright/test');"],
])('a spec that reaches Playwright directly (%s) is reported, with the support module still required', (line) => {
  expect(specProblems('e2e/a.spec.ts', `${GOOD}${line}\n`)).toEqual([
    'e2e/a.spec.ts: import test and expect from e2e/support/test.ts, never from @playwright/test',
  ]);
});

test('a spec that imports nothing from the support module is reported', () => {
  expect(specProblems('e2e/a.spec.ts', "test('x', () => {});")).toEqual([
    'e2e/a.spec.ts: does not import test and expect from e2e/support/test.ts',
  ]);
});

test.each([
  ["import { test } from './test.ts';"],
  ["import { test } from 'support/test.ts';"],
  ["import { test } from './support/test';"],
])('the import %s is not the support module', (line) => {
  expect(specProblems('e2e/a.spec.ts', line)).toHaveLength(1);
});

test('a screenshot comparison outside a visual spec is reported', () => {
  const source = `${GOOD}await expect(page).toHaveScreenshot('x.png');\n`;
  expect(specProblems('e2e/smoke.spec.ts', source)).toEqual([
    'e2e/smoke.spec.ts: compares a screenshot, so its name must end in .visual.spec.ts',
  ]);
  expect(specProblems('e2e/smoke.visual.spec.ts', source)).toEqual([]);
});

test('every spec of the repository follows the rules, and the two specs of the story exist', () => {
  const files = specFiles(E2E);
  expect(files).toEqual(expect.arrayContaining(['e2e/canary.visual.spec.ts', 'e2e/smoke.spec.ts']));
  for (const file of files) {
    expect(specProblems(file, readText(path.join(ROOT, file)))).toEqual([]);
  }
});

test('the support module applies the visual guard to every test through an automatic fixture', () => {
  const source = readText(path.join(E2E, 'support', 'test.ts'));
  expect(source).toContain('visualSkipReason(testInfo.file, process.env)');
  expect(source).toContain('{ auto: true }');
});
