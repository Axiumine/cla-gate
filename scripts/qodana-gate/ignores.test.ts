// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { sourceFiles } from '../code-caps/files.ts';
import { git, makeRepo, tempDir } from '../code-caps/test-support.ts';
import { activeLines, ROOT, repoText } from '../semgrep-rules/test-support.ts';
import { yamlOf } from '../trivy-gate/test-support.ts';

// E20-S08: .qodana/ holds the coverage input the qodana job downloads (and Qodana's local results). It is generated
// output, so it is git-ignored, ESLint and FTA skip it, and Biome and the caps tool, which follow .gitignore inside git,
// never see a file there.

const INPUT = '.qodana/code-coverage';
const SOURCE = 'export const a = 1;\n';
// Not what Biome's formatter writes (spaces around the keyword, no semicolon) and not under a cap: only the ignore saves it.
const UNFORMATTED = 'export   const   b  =  2\n';

test('.gitignore lists .qodana/ as a directory', () => {
  expect(activeLines(repoText('.gitignore'))).toContain('.qodana/');
});

test('ESLint ignores everything below .qodana, and still lints the sources next to it', () => {
  const script = [
    "import { ESLint } from 'eslint';",
    'const eslint = new ESLint();',
    `const names = ['${INPUT}/lcov.ts', '.qodana/results/report.mjs', 'src/server/main.ts'];`,
    'console.log(JSON.stringify(await Promise.all(names.map((name) => eslint.isPathIgnored(name)))));',
  ].join('\n');
  // A child process on purpose: ESLint loads eslint.config.mjs and the TypeScript it imports natively.
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual([true, true, false]);
});

test('FTA excludes the .qodana directory at the repository root', () => {
  const config = z.object({ exclude_directories: z.array(z.string()) }).parse(yamlOf('fta.json'));
  expect(config.exclude_directories).toContain('/.qodana');
});

/** A repository with the real .gitignore and Biome config, one source file and one badly formatted file in .qodana. */
function repoWithQodanaInput(gitignore: string) {
  const root = tempDir();
  makeRepo(root, {
    '.gitignore': gitignore,
    'biome.json': repoText('biome.json'),
    'src/a.ts': SOURCE,
    [`${INPUT}/lcov.ts`]: UNFORMATTED,
    [`${INPUT}/lcov.info`]: 'SF:src/a.ts\n',
  });
  git(root, 'init', '-q');
  return root;
}

test('the caps tool lists no file below .qodana in a git work tree', () => {
  expect(sourceFiles(repoWithQodanaInput(repoText('.gitignore')))).toEqual(['src/a.ts']);
});

test('control: without the .gitignore line the caps tool does list it, so the line is what hides the file', () => {
  const without = repoText('.gitignore').replace('.qodana/\n', '');
  expect(sourceFiles(repoWithQodanaInput(without))).toEqual([`${INPUT}/lcov.ts`, 'src/a.ts']);
});

function biome(root: string) {
  const bin = path.join(ROOT, 'node_modules/@biomejs/biome/bin/biome');
  return spawnSync(process.execPath, [bin, 'ci', '--error-on-warnings', '.'], { cwd: root, encoding: 'utf8' });
}

test('Biome checks the source file and reports nothing for the unformatted file below .qodana', () => {
  const result = biome(repoWithQodanaInput(repoText('.gitignore')));
  expect(result.status).toBe(0);
  expect(`${result.stdout}${result.stderr}`).not.toContain('.qodana');
});

test('control: without the .gitignore line Biome does fail on that file, so the line is what hides it', () => {
  const result = biome(repoWithQodanaInput(repoText('.gitignore').replace('.qodana/\n', '')));
  expect(result.status).toBe(1);
  expect(`${result.stdout}${result.stderr}`).toContain(`${INPUT}/lcov.ts`);
});
