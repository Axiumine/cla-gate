// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { exists, readText } from '../ci/lib/test-support.ts';
import { listDir, ROOT } from '../semgrep-rules/test-support.ts';
import { CONTROL_CASES } from './control.ts';
import { ORIGIN_VARIABLE } from './fixture-url.ts';
import { CONTROL_DIR, FIXTURES_DIR, SCENARIOS_DIR } from './paths.ts';
import { scenarioOf } from './scenario.ts';
import { loadModule } from './system.ts';

// E20-S07: every scenario file of the repository has the shape memlab wants, loads a fixture that exists, and holds no port.

const ORIGIN = 'http://127.0.0.1:40999';

afterEach(() => {
  vi.unstubAllEnvs();
});

const FILES = [
  ...listDir(SCENARIOS_DIR).map((name) => path.join(SCENARIOS_DIR, name)),
  ...CONTROL_CASES.map((each) => path.join(CONTROL_DIR, `${each.name}.ts`)),
];

test('there is the canary scenario, and the control has its three', () => {
  expect(listDir(SCENARIOS_DIR)).toContain('canary-navigation.ts');
  expect(FILES.length).toBeGreaterThanOrEqual(4);
});

test.each(FILES.map((file) => [path.relative(ROOT, file), file]))(
  '%s default-exports { url, action, back } and its url is a fixture on the origin the wrapper serves',
  async (_label, file) => {
    vi.stubEnv(ORIGIN_VARIABLE, ORIGIN);
    const scenario = scenarioOf(await loadModule(file), file);
    const url = new URL(scenario.url());
    expect(url.origin).toBe(ORIGIN);
    expect(exists(path.join(FIXTURES_DIR, url.pathname.slice(1)))).toBe(true);
  },
);

test.each(FILES.map((file) => [path.basename(file), file]))(
  '%s names no host, no protocol and no port',
  (_label, file) => {
    const code = readText(file)
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n');
    expect(code).toContain('fixtureUrl(');
    expect(code).not.toMatch(/https?:|localhost|127\.0\.0\.1|0\.0\.0\.0|:\d{2,5}\b|\bport\b/i);
  },
);

test('the canary opens and closes the panel of the clean fixture', () => {
  const code = readText(path.join(SCENARIOS_DIR, 'canary-navigation.ts'));
  expect(code).toContain("fixtureUrl('clean.html')");
  expect(code).toContain("page.click('#open')");
  expect(code).toContain("page.click('#close')");
});

test('the control scenarios use the leaking fixture, the clean fixture, and a click on an element that is not there', () => {
  expect(readText(path.join(CONTROL_DIR, 'leaking.ts'))).toContain("fixtureUrl('leaky.html')");
  expect(readText(path.join(CONTROL_DIR, 'clean.ts'))).toContain("fixtureUrl('clean.html')");
  expect(readText(path.join(CONTROL_DIR, 'broken.ts'))).toContain("page.click('#no-such-element')");
});
