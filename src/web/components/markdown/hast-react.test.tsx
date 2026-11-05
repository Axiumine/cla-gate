// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import { render } from '@testing-library/react';
import type { Element, Root, RootContent } from 'hast';
import { expect, test } from 'vitest';
import { drawTree } from './hast-react.tsx';

// E18-S01: the step from the sanitised tree to React elements, fed trees that the sanitiser would never make. The component
// is built to be safe even then: an element it does not know is not drawn, no attribute of the tree is copied, and what the
// tree holds besides elements and text is nothing.

const text = (value: string): RootContent => ({ type: 'text', value });
const element = (tagName: string, properties: Element['properties'], ...children: RootContent[]): Element => ({
  type: 'element',
  tagName,
  properties,
  children: children.filter((child): child is Element['children'][number] => child.type !== 'doctype'),
});
const html = (...children: RootContent[]): string => {
  const root: Root = { type: 'root', children };
  return render(<div>{drawTree(root, 2)}</div>).container.innerHTML;
};

test.each([
  ['a script', element('script', {}, text('alert(1)')), '<div>alert(1)</div>'],
  ['an img', element('img', { src: 'x', onerror: 'alert(1)' }), '<div></div>'],
  ['an iframe with text', element('iframe', { src: 'javascript:x' }, text('inside')), '<div>inside</div>'],
  [
    'a div around a paragraph',
    element('div', {}, element('p', {}, text('kept'))),
    '<div><p class="my-3 leading-relaxed">kept</p></div>',
  ],
])('%s is not drawn, and its content stays', (_label, node, expected) => {
  expect(html(node)).toBe(expected);
});

test('no attribute of the tree is copied to an element, an event handler included', () => {
  const output = html(
    element('p', { onclick: 'alert(1)', id: 'x', style: 'display:none', className: ['evil'] }, text('hi')),
  );
  expect(output).toBe('<div><p class="my-3 leading-relaxed">hi</p></div>');
});

test('a link is drawn with the address the tree gives and the three attributes that make it safe to follow', () => {
  expect(html(element('a', { href: 'https://example.org/', onclick: 'x()' }, text('go')))).toBe(
    '<div><a href="https://example.org/" rel="noopener noreferrer nofollow" target="_blank" class="underline underline-offset-2 wrap-anywhere">go</a></div>',
  );
});

test.each([
  ['no address', {}],
  ['an address that is undefined', { href: undefined }],
])('a link with %s is its content', (_label, properties) => {
  expect(html(element('a', properties, text('go')))).toBe('<div>go</div>');
});

test.each([
  ['a number', { start: 4 }, ' start="4"'],
  ['text', { start: '4' }, ''],
  ['nothing', {}, ''],
])('the start of an ordered list is read from %s', (_label, properties, attribute) => {
  expect(html(element('ol', properties, element('li', {}, text('x'))))).toBe(
    `<div><ol${attribute} class="my-3 list-decimal ps-6"><li class="my-1">x</li></ol></div>`,
  );
});

test('a comment, a doctype and a raw node are nothing', () => {
  expect(
    html({ type: 'comment', value: 'hidden' }, { type: 'doctype' }, { type: 'raw', value: '<b>x</b>' }, text('t')),
  ).toBe('<div>t</div>');
});

test('a line break and a rule have no content', () => {
  expect(html(element('br', {}), element('hr', {}))).toBe('<div><br><hr class="my-4 border-line"></div>');
});
