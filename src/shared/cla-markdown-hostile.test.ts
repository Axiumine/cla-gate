// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Nodes } from 'hast';
import { expect, test } from 'vitest';
import { renderClaHtml, renderClaTree } from './cla-markdown.ts';
import { HOSTILE_CLA_ROWS, hastNodes, hastText } from './test-support.ts';

// The sanitiser of the CLA text (E12-S07) against hostile input. Every row is rendered, the output tree is walked node by node and
// the output HTML is checked with a pattern that is not the one the sanitiser uses: only the allowed tag names, no property that is
// not allowed, no `on*` property, no address but http, https and mailto, and no image, script, style or iframe. What the signer
// sees is checked too: the markup that was refused is still there as text, because a legal text must show all of what it says.

const ALLOWED_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'em',
  'strong',
  'br',
  'hr',
  'a',
]);
const ALLOWED_PROPERTIES: Record<string, readonly string[]> = { a: ['href', 'rel', 'target'], ol: ['start'] };
const ALLOWED_ADDRESS = /^(?:https?:\/\/|mailto:)/;
const FORBIDDEN_TAGS = ['img', 'script', 'style', 'iframe', 'svg', 'object', 'embed', 'form', 'input'];

const ATTRIBUTE = /^(?:href|rel|target|start)="[^"<>]*"$/;
/** Splits the inside of a tag into its name and its attributes: a space that is followed by `name="` ends one. */
const BEFORE_ATTRIBUTE = / (?=[a-z]+=")/;

const HOSTILE = HOSTILE_CLA_ROWS;

/** Fails unless every node of `tree` is one the sanitiser may leave. */
function expectOnlySafeNodes(tree: Nodes): void {
  for (const node of hastNodes(tree)) {
    expect(['root', 'element', 'text']).toContain(node.type);
    if (node.type !== 'element') {
      continue;
    }
    expect(ALLOWED_TAGS.has(node.tagName), node.tagName).toBe(true);
    expect(FORBIDDEN_TAGS).not.toContain(node.tagName);
    const allowed = ALLOWED_PROPERTIES[node.tagName] ?? [];
    for (const [name, value] of Object.entries(node.properties)) {
      expect(allowed, `${node.tagName}.${name}`).toContain(name);
      expect(name.toLowerCase().startsWith('on')).toBe(false);
      if (name === 'href') {
        expect(String(value)).toMatch(ALLOWED_ADDRESS);
      }
    }
  }
}

/**
 * Fails unless every tag of `html` is an allowed one with allowed attributes only. The serialiser escapes every `<` of text, so
 * each `<` that is left starts a tag: what follows it, up to the first `>`, is the inside of that tag.
 */
function expectOnlySafeTags(html: string): void {
  for (const piece of html.split('<').slice(1)) {
    const end = piece.indexOf('>');
    expect(end, piece).toBeGreaterThan(0);
    const [name = '', ...attributes] = piece.slice(0, end).replace(/^\//, '').split(BEFORE_ATTRIBUTE);
    expect(ALLOWED_TAGS.has(name), piece).toBe(true);
    for (const attribute of attributes) {
      expect(attribute, piece).toMatch(ATTRIBUTE);
    }
  }
}

test.each(HOSTILE)(
  'hostile input, %s: only safe nodes remain, and what was refused is shown as text',
  (_label, source, shown) => {
    const tree = renderClaTree(source);
    expectOnlySafeNodes(tree);
    expect(hastText(tree)).toContain(shown);
    const html = renderClaHtml(source);
    expectOnlySafeTags(html);
    expect(html).not.toMatch(/<(?:img|script|style|iframe)/i);
  },
);

test('the table holds at least 20 rows, and every one of them is a different input', () => {
  expect(HOSTILE.length).toBeGreaterThanOrEqual(20);
  expect(new Set(HOSTILE.map(([, source]) => source)).size).toBe(HOSTILE.length);
});

test.each([
  ['a link with a title', '[x](http://ok.example "onmouseover=alert(1)")', 'http://ok.example'],
  [
    'a link whose address has a quote',
    '[x](http://ok.example/"onmouseover="alert(1))',
    'http://ok.example/%22onmouseover=%22alert(1)',
  ],
  ['a mail address', '[x](mailto:a@b.example)', 'mailto:a@b.example'],
  ['an image inside a safe link', '[![pixel](http://t.example/p.png)](http://ok.example)', 'http://ok.example'],
  ['an autolink', '<https://ok.example/a?b=c>', 'https://ok.example/a?b=c'],
])(
  'a safe link stays a link, %s, and gets the three attributes that make it safe to follow',
  (_label, source, href) => {
    const anchors = hastNodes(renderClaTree(source)).filter((node) => node.type === 'element' && node.tagName === 'a');
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toMatchObject({
      properties: { href, rel: ['noopener', 'noreferrer', 'nofollow'], target: '_blank' },
    });
    expect(renderClaHtml(source)).toContain(` rel="noopener noreferrer nofollow" target="_blank">`);
  },
);

test('a hostile title or quote never becomes an attribute of the serialised link', () => {
  const html = renderClaHtml('[x](http://ok.example/"onmouseover="alert(1) "title")');
  expect(html).toBe(
    '<p><a href="http://ok.example/%22onmouseover=%22alert(1)" rel="noopener noreferrer nofollow" target="_blank">x</a></p>',
  );
});
