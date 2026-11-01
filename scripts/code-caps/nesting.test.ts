// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { depthOf, kinds } from './test-support.ts';

/** `depth` nested `if` statements around a leaf. */
function nestedIfs(depth: number): string {
  return `${'if (x) { '.repeat(depth)}x;${' }'.repeat(depth)}`;
}

/** Statements nested 4 deep inside `opener`, so the result is 5 only if `opener` counts a level. */
function underFour(opener: string, closer: string): string {
  return `${opener} ${nestedIfs(4)} ${closer}`;
}

test('four nested blocks are fine and five violate', () => {
  expect(kinds(`function f(x: 1) { ${nestedIfs(4)} }`)).toEqual({});
  expect(kinds(`function f(x: 1) { ${nestedIfs(5)} }`)).toEqual({ 'nesting:f': 5 });
});

test('an else if chain does not deepen the nesting', () => {
  const elifs = Array.from({ length: 10 }, (_, index) => `else if (x === ${index}) { x; }`).join(' ');
  expect(kinds(`function f(x: 1) { if (x === -1) { x; } ${elifs} }`)).toEqual({});
  expect(depthOf(`if (x) { x; } else if (x) { if (x) { x; } } else { x; }`)).toBe(2);
});

test('an if inside an else block is real nesting', () => {
  expect(depthOf('if (x) { x; } else { if (x) { x; } }')).toBe(2);
  expect(depthOf('if (x) { x; } else { x; }')).toBe(1);
  expect(depthOf('if (x) x; else x;')).toBe(1);
});

test('every loop kind counts one level', () => {
  expect(depthOf('for (;;) { x; }')).toBe(1);
  expect(depthOf('for (const a in x) { x; }')).toBe(1);
  expect(depthOf('for (const a of x) { x; }')).toBe(1);
  expect(depthOf('while (x) { x; }')).toBe(1);
  expect(depthOf('do { x; } while (x);')).toBe(1);
  expect(depthOf('for await (const a of x) { x; }')).toBe(1);
});

test('loops nest with each other and with ifs', () => {
  const loops = 'for (;;) { for (const a in x) { for (const b of x) { while (x) { do { x; } while (x); } } } }';
  expect(depthOf(loops)).toBe(5);
});

test('try, catch and finally each hold one level', () => {
  expect(depthOf(underFour('try {', '} catch {}'))).toBe(5);
  expect(depthOf(underFour('try {} catch {', '}'))).toBe(5);
  expect(depthOf(underFour('try {} finally {', '}'))).toBe(5);
  expect(depthOf('try { x; } catch { x; } finally { x; }')).toBe(1);
  expect(depthOf('try { x; } catch (e) { x; }')).toBe(1);
});

test('a switch is one level, whatever its clauses', () => {
  expect(depthOf(underFour('switch (x) { case 1:', '}'))).toBe(5);
  expect(depthOf(underFour('switch (x) { default:', '}'))).toBe(5);
  expect(depthOf('switch (x) { case 1: x; break; case 2: x; }')).toBe(1);
});

test('a with statement counts one level', () => {
  expect(depthOf(underFour('with (x) {', '}'))).toBe(5);
});

test('bare blocks and labels are transparent', () => {
  expect(depthOf(`{ { ${nestedIfs(4)} } }`)).toBe(4);
  expect(depthOf(`outer: { ${nestedIfs(4)} }`)).toBe(4);
  expect(depthOf(`outer: for (;;) { ${nestedIfs(4)} }`)).toBe(5);
});

test('statements without braces count like blocks', () => {
  expect(depthOf('if (x) if (x) if (x) if (x) if (x) x;')).toBe(5);
  expect(depthOf('for (;;) while (x) x;')).toBe(2);
});

test('other statements and expressions add no level', () => {
  expect(depthOf('const a = x ? (x && x) || x : x; return a;')).toBe(0);
  expect(depthOf('throw x;')).toBe(0);
});

test('a nested function is measured on its own', () => {
  const inner = `function inner() { ${nestedIfs(5)} }`;
  expect(kinds(`function outer(x: 1) { if (x) { ${inner} } }`)).toEqual({ 'nesting:outer.inner': 5 });
});

test('a callback or class inside a block is measured on its own', () => {
  const callback = `foo(() => { ${nestedIfs(5)} });`;
  expect(kinds(`function outer(x: 1) { if (x) { ${callback} } }`)).toEqual({ 'nesting:outer.foo()': 5 });
  const klass = `class K { m() { ${nestedIfs(5)} } }`;
  expect(kinds(`function outer(x: 1) { if (x) { ${klass} } }`)).toEqual({ 'nesting:outer.K.m': 5 });
});

test('a function with an expression body has no nesting', () => {
  expect(kinds('const f = (x: 1) => x ? 1 : 2;')).toEqual({});
});

test('JSX and TypeScript syntax are measured in their own file kinds', () => {
  expect(depthOf('if (x) { return <div />; }', 'm.tsx')).toBe(1);
  expect(kinds(`function f(x: 1) { ${nestedIfs(5)} }`, 'm.mts')).toEqual({ 'nesting:f': 5 });
  expect(kinds(`function f(x) { ${nestedIfs(5)} }`, 'm.js')).toEqual({ 'nesting:f': 5 });
  expect(kinds(`function f(x) { ${nestedIfs(5)} }`, 'm.cjs')).toEqual({ 'nesting:f': 5 });
});
