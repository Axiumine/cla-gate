// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { block, kinds } from './test-support.ts';

/** A construct whose function is exactly 51 lines long. */
function big(head: string, tail: string): string {
  return block(head, tail, 51);
}

const CALLBACKS: [string, string, string][] = [
  ['describe with a title', big("describe('outer title', () => {", '});'), 'describe("outer title")'],
  ['a call chain with a title', big("test.each(TABLE)('works %s', () => {", '});'), 'test.each(TABLE)("works %s")'],
  ['a call without a string', big('items.map((x) => {', '});'), 'items.map()'],
  ['the callback is the first argument', big('setTimeout(() => {', '}, 10);'), 'setTimeout()'],
  ['a function expression', big("it('x', function () {", '});'), 'it("x")'],
  ['a template literal title', big('it(`tpl`, () => {', '});'), 'it("tpl")'],
  ['a title that is not a string', big('it(title, () => {', '});'), 'it()'],
  ['parentheses around the callback', big("it('p', (() => {", '}));'), 'it("p")'],
  ['a callee over several lines', big("foo\n  .bar('t', () => {", '});'), 'foo .bar("t")'],
  [
    'a long callee',
    big("longCalleeName.thatKeepsGoingAndGoingAndGoing('x', () => {", '});'),
    'longCalleeName.thatKeepsGoingAndGoingAnd("x")',
  ],
  ['a long title', big(`it('${'a'.repeat(50)}', () => {`, '});'), `it("${'a'.repeat(40)}")`],
];

test.each(CALLBACKS)('names a callback: %s', (_label, source, name) => {
  expect(Object.keys(kinds(source))).toEqual([`function:${name}`]);
});

const WRAPPED: [string, string, string][] = [
  ['parentheses', 'const g = (() => {', '});'],
  ['as', 'const g = (() => {', '}) as unknown;'],
  ['satisfies', 'const g = (() => {', '}) satisfies Fn;'],
  ['a non-null assertion', 'const g = (() => {', '})!;'],
  ['a type assertion', 'const g = <Fn>(() => {', '});'],
  ['nested wrappers', 'const g = ((() => {', '}) as Fn);'],
];

test.each(WRAPPED)('looks through %s around a function', (_label, head, tail) => {
  expect(kinds(big(head, tail))).toEqual({ 'function:g': 51 });
});

test('a function that is not directly bound or passed stays anonymous', () => {
  const anonymous = { 'function:<anonymous>': 51 };
  expect(kinds(big('foo(a ? () => {', '} : null);'))).toEqual(anonymous);
  expect(kinds(big('const g = fallback || function () {', '};'))).toEqual(anonymous);
  expect(kinds(big('x.y += () => {', '};'))).toEqual(anonymous);
});

test('assigning to a member names the function after the member, adding to it does not', () => {
  expect(kinds(big('x.y = () => {', '};'))).toEqual({ 'function:x.y': 51 });
  expect(kinds(big('x.y += () => {', '};'))).toEqual({ 'function:<anonymous>': 51 });
  expect(kinds(big('x.y ||= () => {', '};'))).toEqual({ 'function:<anonymous>': 51 });
});

test('a function called at once is anonymous even when the call has arguments: it is the callee, not a callback', () => {
  const anonymous = { 'function:<anonymous>': 51 };
  expect(kinds(big('(() => {', '})();'))).toEqual(anonymous);
  expect(kinds(big('(() => {', '})(1, 2);'))).toEqual(anonymous);
  expect(kinds(big('(function () {', '})(1);'))).toEqual(anonymous);
  expect(kinds(big('foo(1, () => {', '});'))).toEqual({ 'function:foo()': 51 });
});

test('namespaces qualify what they hold', () => {
  expect(kinds(`namespace NS {\n${big('  function nf() {', '  }')}}\n`)).toEqual({ 'function:NS.nf': 51 });
  expect(kinds(`namespace A.B {\n${big('  function f() {', '  }')}}\n`)).toEqual({ 'function:A.B.f': 51 });
});

test('named object literals qualify their methods, unnamed ones do not', () => {
  expect(kinds(big('const o = { inner: { m() {', '} } };'))).toEqual({ 'function:o.inner.m': 51 });
  expect(kinds(big('const o = { m() {', '} } as const;'))).toEqual({ 'function:o.m': 51 });
  expect(kinds(big('export default { m() {', '} };'))).toEqual({ 'function:m': 51 });
  expect(kinds(big('foo({ m() {', '} });'))).toEqual({ 'function:m': 51 });
});

test('fixing one callback does not rename the others', () => {
  const both = big("describe('one', () => {", '});') + big("describe('two', () => {", '});');
  expect(Object.keys(kinds(both))).toEqual(['function:describe("one")', 'function:describe("two")']);
  const fixed = block("describe('one', () => {", '});', 5) + big("describe('two', () => {", '});');
  expect(Object.keys(kinds(fixed))).toEqual(['function:describe("two")']);
});
