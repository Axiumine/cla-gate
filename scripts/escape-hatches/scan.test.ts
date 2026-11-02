// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { scanSource } from './scan.ts';

/** `[line, hatch, missing]` of every finding in `lines`, joined into one file named `name`. */
function findings(lines: readonly string[], name = 'm.ts'): [number, string, string][] {
  return scanSource(name, `${lines.join('\n')}\n`).map((finding) => [finding.line, finding.hatch, finding.missing]);
}

const REASON_HERE = '"-- <reason>" on this line or the line above';

test.each([
  ['a reason in a comment behind it', ['export const a: any = 1; // eslint-disable-line a -- foreign payload']],
  [
    'a reason in a comment alone on the line above',
    ['// eslint-disable-next-line a -- foreign payload', 'export const a: any = 1;'],
  ],
  ['a reason in a block comment before it', ['/* -- foreign payload */ export const a: any = 1;']],
  ['a reason in a block comment on the line above', ['/* x -- foreign payload */', 'export const a: any = 1;']],
  ['a reason of exactly ten characters', ['export const a: any = 1; // x -- 1234567890']],
  ['one reason for every any on its line', ['export type T = Map<any, any>; // x -- keys are untyped']],
])('an explicit any is justified by %s', (_what, lines) => {
  expect(findings(lines)).toEqual([]);
});

test.each([
  ['no comment at all', ['export const a: any = 1;'], 1],
  ['a comment without a separator', ['export const a: any = 1; // any is fine here'], 1],
  ['a reason of nine characters', ['export const a: any = 1; // x -- 123456789'], 1],
  ['a separator and nothing after it', ['export const a: any = 1; // x --'], 1],
  ['a reason two lines above', ['// x -- foreign payload', '', 'export const a: any = 1;'], 3],
  ['a reason below it', ['export const a: any = 1;', '// x -- foreign payload'], 1],
  [
    'a reason behind other code on the line above',
    ['export const b = 2; // x -- foreign', 'export const a: any = 1;'],
    2,
  ],
  ['a reason in the comment two lines above', ['// x -- foreign payload', '// more words', 'export let a: any;'], 3],
])('an explicit any is NOT justified by %s', (_what, lines, line) => {
  expect(findings(lines)).toEqual([[line, 'any', REASON_HERE]]);
});

test.each([
  ['the as const form', ['export const a = [1] as const;']],
  ['the angle-bracket const form', ['export const a = <const>[1];']],
  ['satisfies', ['export const a = { b: 1 } satisfies { b: number };']],
  ['an import alias', ["import { a as b } from './x.ts';", 'export { b as c };']],
  ['a namespace re-export', ["export * as ns from './x.ts';"]],
  ['an as in a string, a template and a comment', ["export const s = 'x as number';", '// y as string']],
  ['the word any in names, strings and comments', ["const any = 'any'; // any", 'export const o = { any };']],
  ['any in JSDoc types', ['/** @param {any} value */', 'export function f(value) { return value; }']],
  ['an as that has a reason above', ['// x -- rows are untyped here', 'export const a = JSON.parse(`1`) as number;']],
])('allowed: %s', (_what, lines) => {
  expect(findings(lines)).toEqual([]);
});

test.each([
  ['a plain as assertion', 'export const a = JSON.parse(`1`) as number;'],
  ['an angle-bracket assertion', 'export const a = <number>JSON.parse(`1`);'],
  ['an assertion after a call', 'export const a = String(1).split(`,`) as string[];'],
])('%s needs a reason', (_what, line) => {
  expect(findings([line])).toEqual([[1, 'as assertion', REASON_HERE]]);
});

test('as unknown as is one assertion line, reported once', () => {
  expect(findings(['export const a = 1 as unknown as string;'])).toEqual([[1, 'as assertion', REASON_HERE]]);
});

test('an as and an any on one line are two findings, one reason covers both', () => {
  expect(findings(['export const a = 1 as any;'])).toEqual([
    [1, 'as assertion', REASON_HERE],
    [1, 'any', REASON_HERE],
  ]);
  expect(findings(['export const a = 1 as any; // x -- both are deliberate'])).toEqual([]);
});

test('every construct of a file is found, in line order, not only the first', () => {
  const lines = [
    'export const first: any = 1;',
    'export const b = 2;',
    'export function f(value: unknown) {',
    '  return value as string;',
    '}',
    'export const last = <number>JSON.parse(`1`);',
  ];
  expect(findings(lines)).toEqual([
    [1, 'any', REASON_HERE],
    [4, 'as assertion', REASON_HERE],
    [6, 'as assertion', REASON_HERE],
  ]);
});

test('a finding names the file it was found in', () => {
  const [finding] = scanSource('src/server/a.ts', 'export const a: any = 1;\n');
  expect(finding).toEqual({ file: 'src/server/a.ts', line: 1, hatch: 'any', missing: REASON_HERE });
});

const NEEDS_PRESERVE = '"-- @preserve"';
const NEEDS_REASON = 'a reason after "-- @preserve"';

test.each([
  ['a block comment with the marker and a reason', '/* v8 ignore next -- @preserve unreachable by construction */'],
  ['a line comment with the marker and a reason', '// v8 ignore next -- @preserve unreachable by construction'],
  ['a JSDoc-style comment', '/** v8 ignore next -- @preserve unreachable by construction */'],
  ['a counted ignore', '/* v8 ignore next 3 -- @preserve unreachable by construction */'],
  ['an if branch', '/* v8 ignore if -- @preserve the guard cannot fail here */'],
  ['the start of a range', '/* v8 ignore start -- @preserve generated table, no logic */'],
  ['the end of a range', '/* v8 ignore stop -- @preserve end of the generated table */'],
  ['the c8 spelling', '/* c8 ignore next -- @preserve unreachable by construction */'],
  ['the node:coverage spelling', '/* node:coverage ignore next -- @preserve unreachable by construction */'],
  ['a comment that only mentions the directive', '// see the v8 ignore documentation'],
  ['a word that merely starts like the directive', '// v8 ignored lines are listed below'],
])('allowed: %s', (_what, comment) => {
  expect(findings([comment, 'export const a = 1;'])).toEqual([]);
});

test.each([
  ['no marker and no reason', '/* v8 ignore next */', [NEEDS_PRESERVE]],
  ['a reason but no marker', '/* v8 ignore next because it is unreachable */', [NEEDS_PRESERVE]],
  ['a marker but no reason', '/* v8 ignore next -- @preserve */', [NEEDS_REASON]],
  ['a marker and a short reason', '/* v8 ignore next -- @preserve nope */', [NEEDS_REASON]],
  ['a line comment without the marker', '// v8 ignore next', [NEEDS_PRESERVE]],
  ['the end of a range without the marker', '/* v8 ignore stop */', [NEEDS_PRESERVE]],
  ['the c8 spelling without the marker', '/* c8 ignore next */', [NEEDS_PRESERVE]],
  ['the node:coverage spelling without the marker', '/* node:coverage disable */', [NEEDS_PRESERVE]],
])('v8 ignore with %s', (_what, comment, missing) => {
  expect(findings(['export const a = 1;', comment, 'export const b = 2;'])).toEqual(
    missing.map((element) => [2, 'v8 ignore', element]),
  );
});

test.each([
  ['next-line without a reason', '// type-coverage:ignore-next-line', 1],
  ['line without a reason', 'export const a = 1; // type-coverage:ignore-line', 1],
  ['next-line with a short reason', '// type-coverage:ignore-next-line -- nope', 1],
  ['a block comment without a reason', '/* type-coverage:ignore-next-line */', 1],
])('a type-coverage ignore comment: %s', (_what, text, line) => {
  const lines = text.startsWith('export') ? [text] : [text, 'export const a = 1;'];
  expect(findings(lines)).toEqual([[line, 'type-coverage ignore', '"-- <reason>" in the same comment']]);
});

test.each([
  ['next-line with a reason', '// type-coverage:ignore-next-line -- exec() rows are untyped'],
  ['line with a reason', 'export const a = 1; // type-coverage:ignore-line -- exec() rows are untyped'],
])('allowed: a type-coverage ignore comment with %s', (_what, text) => {
  const lines = text.startsWith('export') ? [text] : [text, 'export const a = 1;'];
  expect(findings(lines)).toEqual([]);
});

test('a reason in another comment does not justify a type-coverage ignore comment', () => {
  const lines = ['// x -- some other reason here', '// type-coverage:ignore-next-line', 'export const a = 1;'];
  expect(findings(lines)).toEqual([[2, 'type-coverage ignore', '"-- <reason>" in the same comment']]);
});

test.each([
  ['no reason', '//noinspection JSUnusedLocalSymbols'],
  ['a spaced marker and no reason', '// noinspection JSUnusedLocalSymbols'],
  ['a short reason', '//noinspection JSUnusedLocalSymbols -- nope'],
  ['a block comment and no reason', '/* noinspection JSUnusedLocalSymbols */'],
  ['two inspections and no reason', '//noinspection JSUnusedLocalSymbols,UnusedCatchParameter'],
])('a Qodana noinspection comment with %s', (_what, text) => {
  expect(findings([text, 'export const a = 1;'])).toEqual([[1, 'noinspection', '"-- <reason>" in the same comment']]);
});

test.each([
  ['a reason', '//noinspection JSUnusedLocalSymbols -- read by the template engine at run time'],
  ['two inspections and a reason', '//noinspection JSUnusedLocalSymbols,UnusedCatchParameter -- generated names'],
  ['a comment that only mentions the word', '// the noinspection comments of Qodana are listed in qodana.yaml'],
  ['a word that merely starts like the marker', '// noinspections are reviewed one by one'],
])('allowed: %s', (_what, text) => {
  expect(findings([text, 'export const a = 1;'])).toEqual([]);
});

test('a reason in another comment does not justify a noinspection comment', () => {
  const lines = ['// x -- some other reason here', '//noinspection JSUnusedLocalSymbols', 'export const a = 1;'];
  expect(findings(lines)).toEqual([[2, 'noinspection', '"-- <reason>" in the same comment']]);
});

test('directive text inside strings and templates is never a finding', () => {
  const lines = [
    "export const a = '/* v8 ignore next */ // type-coverage:ignore-line //noinspection Foo';",
    'export const b = `\n// v8 ignore next\n`;',
  ];
  expect(findings(lines)).toEqual([]);
});

test('JavaScript sources are scanned too', () => {
  expect(findings(['// v8 ignore next', 'export const a = 1;'], 'eslint.config.mjs')).toEqual([
    [1, 'v8 ignore', NEEDS_PRESERVE],
  ]);
});

test('findings of every kind come out ordered by line', () => {
  const lines = ['export const a: any = 1;', '/* v8 ignore next */', 'export const b = a as string;'];
  expect(findings(lines).map(([line]) => line)).toEqual([1, 2, 3]);
});
