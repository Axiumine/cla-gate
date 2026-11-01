// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { countLines, dedupeNames, measureSource } from './measure.ts';
import { block, classBlock, func, kinds } from './test-support.ts';
import { CapsError, type Measure } from './types.ts';

// --------------------------------------------------------------------------- function length

test('a function of 50 lines is fine and one of 51 lines violates', () => {
  expect(kinds(func('f', 50))).toEqual({});
  expect(kinds(func('f', 51))).toEqual({ 'function:f': 51 });
});

test('decorators count towards the length of a method', () => {
  const method = (decorator: string): string => `class C {\n${decorator}  m() {\n${'    a;\n'.repeat(48)}  }\n}\n`;
  expect(kinds(method(''))).toEqual({});
  expect(kinds(method('  @deco\n'))).toEqual({ 'function:C.m': 51 });
});

test('the reported line is the first one, decorators included', () => {
  const source = `const a = 1;\nclass C {\n  @deco\n  m() {\n${'    a;\n'.repeat(48)}  }\n}\n`;
  expect(measureSource(source, 'x.ts')).toEqual([{ path: 'x.ts', line: 3, kind: 'function', name: 'C.m', value: 51 }]);
});

const NAMED: [string, string, string][] = [
  ['function declaration', block('function f() {', '}', 51), 'f'],
  ['async function', block('async function f() {', '}', 51), 'f'],
  ['arrow assigned to a const', block('const f = () => {', '};', 51), 'f'],
  ['anonymous function expression', block('const f = function () {', '};', 51), 'f'],
  ['named function expression', block('const f = function g() {', '};', 51), 'g'],
  ['default exported function', block('export default function () {', '}', 51), 'default'],
  ['default exported arrow', block('export default () => {', '};', 51), 'default'],
  ['callback argument', block('foo(() => {', '});', 51), 'foo()'],
  ['object method', block('const o = { m() {', '} };', 51), 'o.m'],
  ['object property arrow', block('const o = { p: () => {', '} };', 51), 'o.p'],
  ['assignment to a member', block('x.y = () => {', '};', 51), 'x.y'],
];

test.each(NAMED)('names a function: %s', (_label, source, name) => {
  expect(kinds(source)).toEqual({ [`function:${name}`]: 51 });
});

const MEMBERS: [string, string, string][] = [
  ['method', '  m() {', 'C.m'],
  ['async generator method', '  async *gen() {', 'C.gen'],
  ['constructor', '  constructor() {', 'C.constructor'],
  ['getter', '  get v() {', 'C.get v'],
  ['setter', '  set v(x: number) {', 'C.set v'],
  ['static block', '  static {', 'C.static'],
  ['arrow property', '  p = () => {', 'C.p'],
];

test.each(MEMBERS)('names a class member: %s', (_label, head, name) => {
  const tail = head.endsWith('=> {') ? '  };' : '  }';
  const source = `class C {\n${block(head, tail, 51)}}\n`;
  expect(kinds(source)).toEqual({ [`function:${name}`]: 51 });
});

test('names default exported and expression classes', () => {
  const method = block('  m() {', '  }', 51);
  expect(kinds(`export default class {\n${method}}\n`)).toEqual({ 'function:default.m': 51 });
  expect(kinds(`const K = class {\n${method}};\n`)).toEqual({ 'function:K.m': 51 });
});

test('nested functions are qualified with their parents', () => {
  const inner = block('    function inner() {', '    }', 51);
  const outer = `function outer() {\n${inner}}\n`;
  expect(kinds(outer)).toEqual({ 'function:outer': 53, 'function:outer.inner': 51 });
});

test('signatures without a body are not measured', () => {
  const source = [
    'function f(a: 1, b: 2, c: 3, d: 4, e: 5): void;',
    'function f(a: 1, b: 2, c: 3, d: 4, e: 5, f: 6): void;',
    'function f(a: 1) {}',
    'declare function d(a: 1, b: 2, c: 3, d: 4, e: 5): void;',
    'abstract class A { abstract m(a: 1, b: 2, c: 3, d: 4, e: 5): void; }',
  ];
  expect(kinds(source.join('\n'))).toEqual({});
});

test('repeated qualified names get a numbered suffix', () => {
  const callback = block('foo(() => {', '});', 51);
  expect(Object.keys(kinds(callback + callback))).toEqual(['function:foo()', 'function:foo()#2']);
});

test('dedupeNames numbers a repeat but not the first or a different name', () => {
  const item: Measure = { path: 'a.ts', line: 1, kind: 'function', name: 'f', value: 60 };
  const other = { ...item, name: 'g' };
  expect(dedupeNames([item, other, item, item]).map((found) => found.name)).toEqual(['f', 'g', 'f#2', 'f#3']);
});

// --------------------------------------------------------------------------- class and file length

test('a class of 300 lines is fine and one of 301 lines violates', () => {
  const sized = (lines: number): string => classBlock('class C {', '}', lines);
  expect(kinds(sized(300))).toEqual({});
  expect(kinds(sized(301))).toEqual({ 'class:C': 301 });
});

test('classes are qualified when nested and measured as expressions', () => {
  const nested = classBlock('  static Inner = class Inner {', '  };', 301);
  expect(kinds(`class Outer {\n${nested}}\n`)).toEqual({ 'class:Outer': 303, 'class:Outer.Inner': 301 });
  expect(kinds(classBlock('const K = class {', '};', 301))).toEqual({ 'class:K': 301 });
  expect(kinds(classBlock('export default class {', '}', 301))).toEqual({ 'class:default': 301 });
});

test('a file of 500 lines is fine and one of 501 lines violates', () => {
  expect(kinds('const x = 1;\n'.repeat(500))).toEqual({});
  expect(kinds('const x = 1;\n'.repeat(501))).toEqual({ 'file:-': 501 });
});

test('the file violation comes first and is reported on line 1', () => {
  const source = `${'const x = 1;\n'.repeat(499)}${func('f', 51)}`;
  const found = measureSource(source, 'x.ts');
  expect(found.map((item) => [item.kind, item.line, item.value])).toEqual([
    ['file', 1, 550],
    ['function', 500, 51],
  ]);
});

test.each<[string, number]>([
  ['', 0],
  ['a', 1],
  ['a\n', 1],
  ['a\n\n', 2],
  ['a\r\nb', 2],
  ['a\rb\r', 2],
  ['a b c', 3],
])('counts the lines of %j', (text, lines) => {
  expect(countLines(text)).toBe(lines);
});

// --------------------------------------------------------------------------- parameters

const SIGNATURES: [string, boolean][] = [
  ['a: 1, b: 2, c: 3, d: 4', false],
  ['a: 1, b: 2, c: 3, d: 4, e: 5', true],
  ['a: 1, b: 2, c: 3, ...rest: 4[]', false],
  ['a: 1, b: 2, c: 3, d: 4, ...rest: 5[]', true],
  ['this: void, a: 1, b: 2, c: 3, d: 4', false],
  ['{ a }: X, [b]: Y, c: 3, d: 4', false],
  ['{ a }: X, [b]: Y, c: 3, d: 4, e: 5', true],
  ['a?: 1, b = 2, c?: 3, d = 4', false],
];

test.each(SIGNATURES)('parameter cap for (%s)', (params, violates) => {
  expect('params:f' in kinds(func('f', 3, params))).toBe(violates);
});

test('arrow functions, methods and constructors count their parameters', () => {
  const five = 'a: 1, b: 2, c: 3, d: 4, e: 5';
  expect(kinds(`const f = (${five}) => 1;`)).toEqual({ 'params:f': 5 });
  expect(kinds(`class C { m(${five}) {} }`)).toEqual({ 'params:C.m': 5 });
  expect(kinds(`class C { constructor(private a: 1, b: 2, c: 3, d: 4, e: 5) {} }`)).toEqual({
    'params:C.constructor': 5,
  });
});

test('a static block has no parameters', () => {
  expect(kinds('class C { static { const a = 1; } }')).toEqual({});
});

test('a function reports every cap it exceeds', () => {
  const nested = 'if (a) { if (a) { if (a) { if (a) { if (a) { a; } } } } }';
  const source = block(`function f(a: 1, b: 2, c: 3, d: 4, e: 5) {\n  ${nested}`, '}', 50);
  expect(kinds(source)).toEqual({ 'function:f': 51, 'params:f': 5, 'nesting:f': 5 });
});

// --------------------------------------------------------------------------- unusable input

test('a syntax error names the file and the line', () => {
  expect(() => measureSource('const a = 1;\nconst = ;\n', 'bad.ts')).toThrow(/^bad\.ts:2: /);
});

test('JSX is a syntax error outside .tsx and TypeScript is one inside .js', () => {
  expect(measureSource('const a = <div />;', 'a.tsx')).toEqual([]);
  expect(() => measureSource('const a = <div />;', 'a.ts')).toThrow(CapsError);
  expect(() => measureSource('const a: number = 1;', 'a.js')).toThrow(CapsError);
  expect(measureSource('const a = 1;', 'a.cjs')).toEqual([]);
});

test('an expression too deep to walk is reported with the file name', () => {
  const source = `const s = ${Array.from({ length: 50_000 }, () => '1').join(' + ')};`;
  expect(() => measureSource(source, 'deep.ts')).toThrow(/^deep\.ts: cannot measure: RangeError/);
  expect(() => measureSource(source, 'deep.ts')).toThrow(CapsError);
});
