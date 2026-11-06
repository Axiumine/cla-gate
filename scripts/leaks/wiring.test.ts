// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { readText } from '../ci/lib/test-support.ts';
import { compareNames } from '../code-caps/types.ts';
import { activeLines, listDir, ROOT, repoText, SCRIPTS } from '../semgrep-rules/test-support.ts';
import { CONTROL_CASES } from './control.ts';
import { APP_DIR, CONTROL_DIR, FIXTURES_DIR, REPORT_DIR, SCENARIOS_DIR, WRAPPER } from './paths.ts';

// E20-S07: the files and scripts that wire memlab into the repository.

const manifest = z
  .object({ devDependencies: z.record(z.string(), z.string()), dependencies: z.record(z.string(), z.string()) })
  .parse(JSON.parse(repoText('package.json')));
const EXACT = /^\d+\.\d+\.\d+$/;

test('memlab and @memlab/api are devDependencies pinned to one exact version, with no range prefix', () => {
  const devDependencies = new Map(Object.entries(manifest.devDependencies));
  expect(devDependencies.get('memlab')).toMatch(EXACT);
  expect(devDependencies.get('@memlab/api')).toMatch(EXACT);
  expect(devDependencies.get('memlab')).toBe(devDependencies.get('@memlab/api'));
  expect(Object.keys(manifest.dependencies)).not.toContain('memlab');
});

test('yarn leaks runs the wrapper and yarn leaks:control runs the control, each with plain node', () => {
  expect(SCRIPTS.get('leaks')).toBe('node tests/leaks/run.ts');
  expect(SCRIPTS.get('leaks:control')).toBe('node tests/leaks/control/run.ts');
});

test('the paths the wrapper and the control use are the files of the repository', () => {
  expect(path.relative(ROOT, WRAPPER)).toBe('tests/leaks/run.ts');
  expect(path.relative(ROOT, SCENARIOS_DIR)).toBe('tests/leaks/scenarios');
  expect(path.relative(ROOT, CONTROL_DIR)).toBe('tests/leaks/control');
  expect(path.relative(ROOT, FIXTURES_DIR)).toBe('tests/leaks/fixtures');
  expect(path.relative(ROOT, REPORT_DIR)).toBe('reports/leaks');
  expect(path.relative(ROOT, APP_DIR)).toBe('dist/web');
  expect(SCRIPTS.get('leaks:control')).toContain(path.relative(ROOT, CONTROL_DIR));
});

test('the report directory is git-ignored, because the caps tool and the linters follow .gitignore', () => {
  expect(activeLines(repoText('.gitignore'))).toContain('reports/');
});

test('the control directory holds one scenario per control case and its entry file, and nothing else', () => {
  expect(listDir(CONTROL_DIR)).toEqual(
    [...CONTROL_CASES.map((each) => `${each.name}.ts`), 'run.ts'].sort(compareNames),
  );
});

test('Knip finds the scenarios, which are imported by name at run time, and the diagnosis-only memlab command', () => {
  const knip = z
    .object({ entry: z.array(z.string()), project: z.array(z.string()), ignoreDependencies: z.array(z.string()) })
    .parse(JSON.parse(repoText('knip.json')));
  expect(knip.entry).toEqual(expect.arrayContaining(['tests/leaks/scenarios/*.ts', 'tests/leaks/control/*.ts']));
  expect(knip.project).toContain('!scripts/leaks/**!');
  expect(knip.ignoreDependencies).toEqual(['memlab']);
});

test('the leak scenarios stay out of the coverage scope by the fixed exclusion list, and inside the e2e TypeScript project', () => {
  expect(repoText('vitest.config.ts')).toContain("'tests/leaks/**'");
  const project = z.object({ include: z.array(z.string()) }).parse(JSON.parse(repoText('tsconfig.e2e.json')));
  expect(project.include).toContain('tests/leaks/**/*.ts');
});

/** The control flow a logic-free entry file must not have. */
const CONTROL_FLOW = /\b(if|else|for|while|do|switch|try|catch|throw)\b\s*[({]|\?\s|&&|\|\|/;

test.each([['tests/leaks/run.ts'], ['tests/leaks/control/run.ts']])(
  '%s is logic-free: no branch, loop or error handling of its own',
  (file) => {
    const code = activeLines(repoText(file))
      .filter((line) => !line.startsWith('//'))
      .join('\n');
    expect(code).not.toMatch(CONTROL_FLOW);
    expect(code).toContain('process.exitCode = await ');
  },
);

test('the wrapper drives the Chromium that Playwright installed and makes memlab throw instead of ending the process', () => {
  const entry = repoText('tests/leaks/run.ts');
  expect(entry).toContain('chromiumBinary: chromium.executablePath()');
  expect(entry).toContain("Reflect.set(config, 'errorHandling', 2)");
  expect(entry).toContain('serveFixtures(root, pickSystemFreePort)');
  expect(entry).toContain('consoleMode: ConsoleMode.SILENT');
});

test('the control runs the wrapper in a child process, so it sees the exit code a real run gives', () => {
  const entry = repoText('tests/leaks/control/run.ts');
  expect(entry).toContain('runChild(process.execPath, [WRAPPER, file], {})');
});

test('the two fixtures differ in the one thing that matters: only the leaking one keeps the rows in a global array', () => {
  const clean = readText(path.join(FIXTURES_DIR, 'clean.html'));
  const leaky = readText(path.join(FIXTURES_DIR, 'leaky.html'));
  expect(leaky).toContain('window.retainedRows = [];');
  expect(leaky).toContain('window.retainedRows.push(row);');
  expect(clean).not.toContain('retainedRows');
  expect(clean.replace(/clean fixture/, 'leaking fixture')).not.toBe(leaky);
});

test.each([['clean.html'], ['leaky.html']])(
  '%s is static and local: no remote address, stylesheet link, image or frame',
  (name) => {
    const page = readText(path.join(FIXTURES_DIR, name));
    expect(page).not.toMatch(/https?:|<link|<img|<iframe|\bsrc=|@import|url\(/i);
    expect(page).toContain('<a id="open" href="#detail">');
    expect(page).toContain('<a id="close" href="#home">');
  },
);

test('the wrapper serves the built dashboard next to the fixtures, from dist/web, answering its API from the table of made-up bodies (E18-S12)', () => {
  const entry = repoText('tests/leaks/run.ts');
  expect(entry).toContain('serveApp({ root: APP_DIR, answers: answerTable() }, pickSystemFreePort)');
  expect(repoText('package.json')).toContain('"build":');
});

test('the scenarios of the screens (E18-S12) open and close a dialog 20 times, switch tenant 10 times and navigate list and detail', () => {
  expect(listDir(SCENARIOS_DIR)).toEqual([
    'canary-navigation.ts',
    'dialog-open-close.ts',
    'navigation-documents.ts',
    'navigation-installations.ts',
    'tenant-switch.ts',
  ]);
  expect(repoText('tests/leaks/scenarios/dialog-open-close.ts')).toContain('const TIMES = 20;');
  expect(repoText('tests/leaks/scenarios/tenant-switch.ts')).toContain('const TIMES = 10;');
  for (const name of ['navigation-documents', 'navigation-installations']) {
    expect(repoText(`tests/leaks/scenarios/${name}.ts`)).toContain('await page.goBack();');
  }
});

test.each([['dialog-open-close'], ['tenant-switch'], ['navigation-documents'], ['navigation-installations']])(
  'the scenario %s finds things by role and visible name and holds no test id, class or selector of its own',
  (name) => {
    const code = activeLines(repoText(`tests/leaks/scenarios/${name}.ts`)).join('\n');
    expect(code).not.toMatch(/data-testid|getByTestId|querySelector|\[class|page\.\$\(/);
    expect(code).toContain("from '../support/dashboard.ts'");
  },
);
