// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { collectIo } from '../ci/lib/test-support.ts';
import { makeRepo, tempDir } from '../code-caps/test-support.ts';
import { formatFinding, main, scanRepository } from './cli.ts';

/** Run the CLI in `root` and return its exit code with what it printed. */
function run(root: string, ...args: string[]): { code: number; out: string[]; err: string[] } {
  const { io, out, err } = collectIo();
  return { code: main(args, root, io), out, err };
}

test('a finding is reported as file, line, hatch and the missing element', () => {
  const finding = { file: 'src/a.ts', line: 7, hatch: 'any', missing: '"-- <reason>"' } as const;
  expect(formatFinding(finding)).toBe('src/a.ts:7: any: missing "-- <reason>"');
});

test('a control character in a file name cannot forge a report line', () => {
  const finding = { file: 'a\nb.ts', line: 1, hatch: 'any', missing: '"-- <reason>"' } as const;
  expect(formatFinding(finding)).toBe('a\\x0ab.ts:1: any: missing "-- <reason>"');
});

test('a repository whose escape hatches are all justified passes', () => {
  const root = tempDir();
  makeRepo(root, { 'src/a.ts': 'export const a = [1] as const;\n', 'src/b.ts': 'export const b = 1;\n' });
  expect(run(root)).toEqual({ code: 0, out: ['escape hatches ok (2 source file(s))'], err: [] });
});

test('an unjustified escape hatch fails and the report names file, line and the missing element', () => {
  const root = tempDir();
  makeRepo(root, {
    'src/clean.ts': 'export const a = 1;\n',
    'src/server/loose.ts': 'export const a = 1;\nexport const b: any = JSON.parse(`1`);\n/* v8 ignore next */\n',
  });
  const { code, out, err } = run(root);
  expect(code).toBe(1);
  expect(out).toEqual([]);
  expect(err).toEqual([
    'src/server/loose.ts:2: any: missing "-- <reason>" on this line or the line above',
    'src/server/loose.ts:3: v8 ignore: missing "-- @preserve"',
    'escape hatches FAILED: 2 without a justification in 2 source file(s)',
  ]);
});

test('files that are not source, and build output, are not scanned', () => {
  const root = tempDir();
  makeRepo(root, {
    'notes.md': 'let x: any;\n',
    'dist/server/app.js': '// v8 ignore next\n',
    'node_modules/pkg/index.js': '// v8 ignore next\n',
    'src/a.ts': 'export const a = 1;\n',
  });
  expect(run(root).out).toEqual(['escape hatches ok (1 source file(s))']);
});

test('scanRepository counts the files and lists the findings in file order', () => {
  const root = tempDir();
  makeRepo(root, { 'b.ts': 'export const b = 1 as number;\n', 'a.ts': 'export const a = 1 as number;\n' });
  const { files, findings } = scanRepository(root);
  expect(files).toBe(2);
  expect(findings.map((finding) => finding.file)).toEqual(['a.ts', 'b.ts']);
});

test('a file name with a control character is printed escaped', () => {
  const root = tempDir();
  makeRepo(root, { 'evil\nname.ts': 'export const a: any = 1;\n' });
  expect(run(root).err[0]).toBe('evil\\x0aname.ts:1: any: missing "-- <reason>" on this line or the line above');
});

test('--root overrides the default root', () => {
  const root = tempDir();
  makeRepo(root, { 'a.ts': 'export const a = 1;\n' });
  const { io, out } = collectIo();
  expect(main(['--root', root], path.join(root, 'does-not-exist'), io)).toBe(0);
  expect(out).toEqual(['escape hatches ok (1 source file(s))']);
});

test('an unknown option is unusable input', () => {
  const { code, out, err } = run(tempDir(), '--nope');
  expect(code).toBe(2);
  expect(out).toEqual([]);
  expect(err).toHaveLength(1);
  expect(err[0]).toMatch(/^escape hatches: .*--nope/);
});

test('a root that does not exist is unusable input', () => {
  const missing = path.join(tempDir(), 'missing');
  const { code, err } = run(missing);
  expect(code).toBe(2);
  expect(err[0]).toMatch(/^escape hatches: ENOENT/);
});
