// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { makeRepo, tempDir } from '../../code-caps/test-support.ts';
import { checkRepository, main, workflowFiles } from './guard-cli.ts';
import { collectIo } from './test-support.ts';

const DIR = '.github/workflows';
const REPOSITORY = path.resolve(import.meta.dirname, '../../..');

function workflow(runsOn: string, extra = ''): string {
  return `on: pull_request\npermissions:\n  contents: read\njobs:\n  build:\n    runs-on: ${runsOn}\n    timeout-minutes: 5\n${extra}`;
}

const GOOD = workflow('[self-hosted, Linux, X64]');
const BAD = workflow('ubuntu-latest');

/** Runs the guard over a temp repository holding `files` (paths relative to the repository). */
function guard(files: Record<string, string>, args: string[] = []) {
  const root = tempDir();
  makeRepo(root, files);
  const { io, out, err } = collectIo();
  const code = main(['--root', root, ...args], '/does/not/exist', io);
  return { code, out, err };
}

/** Ten levels of lists that each repeat the previous one nine times: a billion-laughs style alias expansion. */
function aliasBomb(): string {
  const levels = Array.from({ length: 10 }, (_unused, level) => {
    const previous = level === 0 ? 'a' : `l${level - 1}`;
    const refs = Array<string>(9).fill(`*${previous}`).join(',');
    return `l${level}: &l${level} [${refs}]`;
  });
  return ['a: &a [x,x,x,x,x,x,x,x,x]', ...levels].join('\n');
}

test('workflows in .yml and .yaml, flow or block lists, quoted scalars and anchors all pass', () => {
  const result = guard({
    [`${DIR}/ci.yml`]: GOOD,
    [`${DIR}/block.yaml`]: workflow('\n      - self-hosted\n      - Linux\n      - X64'),
    [`${DIR}/quoted.yml`]: workflow('["self-hosted", \'Linux\', "X64"]'),
    [`${DIR}/hosted.yaml`]: workflow('"ubuntu-24.04"'),
    [`${DIR}/anchors.yml`]: workflow(
      '&r [self-hosted, Linux, X64]',
      '  other:\n    runs-on: *r\n    timeout-minutes: 5\n',
    ),
  });
  expect(result).toEqual({ code: 0, out: ['ci runners ok (5 workflow file(s))'], err: [] });
});

test('an empty workflows directory is fine', () => {
  const root = tempDir();
  makeRepo(root, { [`${DIR}/.gitkeep`]: '' });
  const { io, out, err } = collectIo();
  expect(main(['--root', root], '/unused', io)).toBe(0);
  expect(out).toEqual(['ci runners ok (0 workflow file(s))']);
  expect(err).toEqual([]);
});

test('a repository without a workflows directory is unusable input, not a pass', () => {
  const { code, out, err } = guard({ 'README.md': 'x' });
  expect(code).toBe(2);
  expect(out).toEqual([]);
  expect(err).toHaveLength(1);
  expect(err[0]).toMatch(/^ci runners: ENOENT/);
});

test('violations are listed per file in code point order, then summarised, with exit code 1', () => {
  const { code, out, err } = guard({
    [`${DIR}/b.yml`]: BAD,
    [`${DIR}/a.yaml`]: BAD.replace('on: pull_request', 'on: pull_request_target'),
    [`${DIR}/ok.yml`]: GOOD,
  });
  expect(code).toBe(1);
  expect(out).toEqual([]);
  expect(err).toEqual([
    `${DIR}/a.yaml: workflow: R3 trigger pull_request_target is forbidden`,
    `${DIR}/a.yaml: job "build": R1 runs-on must be the literal ubuntu-24.04 or the literal list [self-hosted, Linux, X64], found "ubuntu-latest"`,
    `${DIR}/b.yml: job "build": R1 runs-on must be the literal ubuntu-24.04 or the literal list [self-hosted, Linux, X64], found "ubuntu-latest"`,
    'ci runners FAILED: 3 violation(s) in 3 workflow file(s)',
  ]);
});

test('only .yml and .yaml files directly inside the directory are workflows', () => {
  const root = tempDir();
  makeRepo(root, {
    [`${DIR}/ci.yml`]: GOOD,
    [`${DIR}/UPPER.YML`]: GOOD,
    [`${DIR}/notes.md`]: 'not yaml: [',
    [`${DIR}/ci.yml.disabled`]: BAD,
    [`${DIR}/script.sh`]: 'exit 0',
    [`${DIR}/nested/evil.yml`]: BAD,
    [`${DIR}/folder.yml/inner.yml`]: BAD,
  });
  expect(workflowFiles(root)).toEqual([`${DIR}/UPPER.YML`, `${DIR}/ci.yml`]);
});

test('a file that differs only in case from the extension is still judged', () => {
  const { code, err } = guard({ [`${DIR}/SNEAKY.YAML`]: BAD });
  expect(code).toBe(1);
  expect(err[0]).toMatch(/^\.github\/workflows\/SNEAKY\.YAML: job "build": R1 /);
});

test.each([
  ['an unclosed flow list', 'on: push\njobs: [\n'],
  ['tab indentation', 'on: push\njobs:\n\tbuild: 1\n'],
  [
    'a duplicate runs-on key',
    workflow('ubuntu-24.04', '').replace(
      '    timeout-minutes: 5\n',
      '    runs-on: self-hosted\n    timeout-minutes: 5\n',
    ),
  ],
  ['two documents in one file', `${GOOD}---\n${GOOD}`],
  ['an alias bomb', aliasBomb()],
])('%s is unusable input', (_what, text) => {
  const { code, out, err } = guard({ [`${DIR}/ci.yml`]: text });
  expect(code).toBe(2);
  expect(out).toEqual([]);
  expect(err).toHaveLength(1);
  expect(err[0]).toMatch(/^ci runners: \.github\/workflows\/ci\.yml: not valid YAML: /);
});

test('a recursive alias cannot hang or crash the guard: it is unusable input', () => {
  const { code, err } = guard({ [`${DIR}/ci.yml`]: workflow('&a [*a]') });
  expect(code).toBe(2);
  expect(err[0]).toMatch(/^ci runners: Converting circular structure to JSON/);
});

test.each([
  ['an empty file', ''],
  ['a plain scalar', 'just text'],
  ['a mapping without jobs', 'on: push\n'],
])('%s is not a workflow: exit code 2', (_what, text) => {
  const { code, err } = guard({ [`${DIR}/ci.yml`]: text });
  expect(code).toBe(2);
  expect(err).toEqual([`ci runners: ${DIR}/ci.yml: not a workflow (a mapping with "on" and "jobs" is required)`]);
});

test('a merge key is not expanded, so a job that relies on it fails R1 instead of slipping through', () => {
  const text = [
    'on: push',
    'permissions:',
    '  contents: read',
    'x-base: &base',
    '  runs-on: ubuntu-latest',
    '  timeout-minutes: 5',
    'jobs:',
    '  build:',
    '    <<: *base',
  ].join('\n');
  const { code, err } = guard({ [`${DIR}/ci.yml`]: text });
  expect(code).toBe(1);
  expect(err[0]).toMatch(/job "build": R1 .*found nothing$/);
});

test('an unknown option is unusable input', () => {
  const { code, err } = guard({ [`${DIR}/ci.yml`]: GOOD }, ['--nope']);
  expect(code).toBe(2);
  expect(err[0]).toMatch(/^ci runners: Unknown option '--nope'/);
});

test('without --root the default root is used', () => {
  const root = tempDir();
  makeRepo(root, { [`${DIR}/ci.yml`]: GOOD });
  const { io, out } = collectIo();
  expect(main([], root, io)).toBe(0);
  expect(out).toEqual(['ci runners ok (1 workflow file(s))']);
});

test('checkRepository reports the file count together with the violations', () => {
  const root = tempDir();
  makeRepo(root, { [`${DIR}/ci.yml`]: BAD, [`${DIR}/two.yml`]: GOOD });
  const { files, violations } = checkRepository(root);
  expect(files).toBe(2);
  expect(violations.map((violation) => violation.rule)).toEqual(['R1']);
});

test("this repository's own workflows pass the guard", () => {
  const { files, violations } = checkRepository(REPOSITORY);
  expect(violations).toEqual([]);
  expect(files).toBeGreaterThanOrEqual(1);
});
