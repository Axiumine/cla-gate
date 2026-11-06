// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { RENDER_FAILED, renderRequestSchema, treeOf } from './render-protocol.ts';

// E18: what the page and the render worker say to each other, and how each side reads what it gets.

test('a request is the source of a text and nothing else is required of it', () => {
  expect(renderRequestSchema.safeParse({ source: '# Terms' }).success).toBe(true);
  expect(renderRequestSchema.safeParse({ source: '' }).success).toBe(true);
});

test.each([
  ['a text that is not in an object', '# Terms'],
  ['no source', {}],
  ['a source that is not text', { source: 7 }],
  ['nothing', undefined],
  ['null', null],
])('%s is no request', (_what, message) => {
  expect(renderRequestSchema.safeParse(message).success).toBe(false);
});

test('the tree of an answer is the root it holds, with its children', () => {
  const tree = { type: 'root', children: [{ type: 'text', value: 'x' }] };
  expect(treeOf({ tree })).toBe(tree);
  expect(treeOf({ tree: { type: 'root', children: [] } })).toEqual({ type: 'root', children: [] });
});

test.each([
  ['the failure', RENDER_FAILED],
  ['a tree that is a string', { tree: 'root' }],
  ['a tree that is null', { tree: null }],
  ['a tree that is not a root', { tree: { type: 'element', children: [] } }],
  ['a root with no children', { tree: { type: 'root' } }],
  ['a root whose children are not a list', { tree: { type: 'root', children: 'x' } }],
  ['a text', 'tree'],
  ['null', null],
  ['nothing', undefined],
])('%s is no tree', (_what, answer) => {
  expect(treeOf(answer)).toBeUndefined();
});
