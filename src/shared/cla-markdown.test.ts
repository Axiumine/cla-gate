// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Element, Nodes, Root } from 'hast';
import { expect, test } from 'vitest';
import { renderClaHtml, renderClaTree } from './cla-markdown.ts';
import { CLA_MAX_NESTING } from './cla-markdown-nesting.ts';
import { canonicalise, validateClaText } from './cla-text.ts';
import { hastNodes, hastText, indentedBullets, nestedBullets, nestedEmphasis, nestedQuotes } from './test-support.ts';

// The rendering of the CLA text (E12-S07): what it keeps, what it turns into text, how it treats a text that nests too deeply or
// is hostile to the parser, and that every view gets the same tree from the same text. The hostile table is in
// cla-markdown-hostile.test.ts.

/** The elements of a tree, in document order. */
const elementsOf = (tree: Nodes): Element[] => hastNodes(tree).filter((node) => node.type === 'element');
const tagsOf = (tree: Nodes): string[] => elementsOf(tree).map((element) => element.tagName);

/** A multi-section document with every construct the rendering keeps. It says nothing legal: it is a sample of the Markdown. */
const SAMPLE = [
  '# Sample document',
  '',
  'An opening paragraph with *emphasis*, **strong text**, `inline code` and a [link](https://example.org/terms "a title").',
  'A second line in the same paragraph,  ',
  'and a line after a hard break.',
  '',
  '## Part one',
  '',
  '1. First item',
  '2. Second item',
  '   - a nested bullet',
  '',
  '### A smaller heading',
  '',
  '- one',
  '- two',
  '',
  '> A quoted paragraph.',
  '',
  '---',
  '',
  '#### Four',
  '##### Five',
  '###### Six',
  '',
  '```text',
  'A block of code with <angle brackets> & an ampersand',
  '```',
  '',
  '7. A list that starts at seven',
  '',
].join('\n');

test('every element a text can have is kept, and nothing else is in the tree', () => {
  const tags = new Set(tagsOf(renderClaTree(SAMPLE)));
  const expected = new Set(['a', 'blockquote', 'br', 'code', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
  for (const tag of ['hr', 'li', 'ol', 'p', 'pre', 'strong', 'ul']) {
    expected.add(tag);
  }
  expect(tags).toEqual(expected);
});

test('the tree of a text is a root whose children are the blocks of the text and the line feeds between them', () => {
  const tree = renderClaTree('One\n\nTwo\n');
  expect(tree.type).toBe('root');
  expect(tree.children.map((child) => (child.type === 'element' ? child.tagName : child.type))).toEqual([
    'p',
    'text',
    'p',
  ]);
  expect(hastText(tree)).toBe('One\nTwo');
});

test('an ordered list keeps its first number, and only when it is not 1', () => {
  expect(renderClaHtml('1. a\n2. b\n')).toBe('<ol>\n<li>a</li>\n<li>b</li>\n</ol>');
  expect(renderClaHtml('7. a\n8. b\n')).toBe('<ol start="7">\n<li>a</li>\n<li>b</li>\n</ol>');
});

test('the language of a fenced block, a class, an id and every other property are dropped', () => {
  const html = renderClaHtml('```js\nlet x = 1;\n```\n\n# Heading\n');
  expect(html).toBe('<pre><code>let x = 1;\n</code></pre>\n<h1>Heading</h1>');
});

test('emphasis, strong text, code spans, a hard break, a rule and a block quote are the plain elements', () => {
  expect(renderClaHtml('*a* **b** `c`  \nd\n\n---\n\n> e\n')).toBe(
    '<p><em>a</em> <strong>b</strong> <code>c</code><br>\nd</p>\n<hr>\n<blockquote>\n<p>e</p>\n</blockquote>',
  );
});

test.each([
  ['a placeholder', 'I, <full name>, agree.', '<p>I, &#x3C;full name>, agree.</p>', 'I, <full name>, agree.'],
  [
    'a tag with attributes',
    'See <b class="x">this</b>.',
    '<p>See &#x3C;b class="x">this&#x3C;/b>.</p>',
    'See <b class="x">this</b>.',
  ],
  ['a block of HTML', '<div>\nhello\n</div>', '<p>&#x3C;div>\nhello\n&#x3C;/div></p>', '<div>\nhello\n</div>'],
  ['a comment', '<!-- note -->', '<p>&#x3C;!-- note --></p>', '<!-- note -->'],
  ['an ampersand', 'a & b &amp; c', '<p>a &#x26; b &#x26; c</p>', 'a & b & c'],
])('raw HTML is literal text, %s: it is visible, not dropped and not read as markup', (_label, source, html, shown) => {
  expect(renderClaHtml(source)).toBe(html);
  expect(hastText(renderClaTree(source))).toBe(shown);
  expect(elementsOf(renderClaTree(source)).map((element) => element.tagName)).toEqual(['p']);
});

test('inside a code block the angle brackets are the text of the block', () => {
  expect(renderClaHtml('```\n<company name>\n```\n')).toBe('<pre><code>&#x3C;company name>\n</code></pre>');
});

test.each([
  ['an image', 'See ![the logo](https://img.example/a.png) here.', 'See the logo here.'],
  ['an image with no alternative text', 'See ![](https://img.example/a.png) here.', 'See  here.'],
  [
    'an image written as a reference',
    'See ![the logo][l] here.\n\n[l]: https://img.example/a.png\n',
    'See the logo here.',
  ],
  ['an image with emphasis in its alternative text', '![the *old* logo](https://img.example/a.png)', 'the old logo'],
])('images are never rendered, %s: the alternative text stays as plain text', (_label, source, shown) => {
  const tree = renderClaTree(source);
  expect(tagsOf(tree)).toEqual(['p']);
  expect(hastText(tree)).toBe(shown);
});

test.each([
  ['a relative path', '[terms](/terms)'],
  ['a protocol-relative address', '[terms](//cdn.example/terms)'],
  ['a fragment', '[terms](#terms)'],
  ['a file address', '[terms](file:///etc/passwd)'],
  ['a scheme in capitals', '[terms](HTTPS://example.org)'],
])('a link to %s is unwrapped to its text', (_label, source) => {
  const tree = renderClaTree(source);
  expect(tagsOf(tree)).toEqual(['p']);
  expect(hastText(tree)).toBe('terms');
});

test('a link keeps its text and its emphasis, and an unwrapped link keeps the emphasis of its text too', () => {
  expect(renderClaHtml('[a *b* c](https://example.org) and [d *e* f](/x)')).toBe(
    '<p><a href="https://example.org" rel="noopener noreferrer nofollow" target="_blank">a <em>b</em> c</a> and d <em>e</em> f</p>',
  );
});

test('the properties of a link are exactly href, rel and target, in that order', () => {
  const [anchor] = elementsOf(renderClaTree('<https://example.org>')).filter((element) => element.tagName === 'a');
  expect(Object.keys(anchor?.properties ?? {})).toEqual(['href', 'rel', 'target']);
});

test('the same text gives the same tree and the same HTML, call after call', () => {
  const first = renderClaTree(SAMPLE);
  expect(renderClaTree(SAMPLE)).toStrictEqual(first);
  expect(renderClaHtml(SAMPLE)).toBe(renderClaHtml(SAMPLE));
  expect(JSON.parse(JSON.stringify(first))).toStrictEqual(first);
});

test('the editor preview, the sign page and the history view get one tree: the draft text and the published text of equal bytes', () => {
  const draftText = canonicalise(SAMPLE.replaceAll('\n', '\r\n'));
  const publishedText = canonicalise(SAMPLE);
  expect(publishedText).toBe(draftText);
  expect(renderClaTree(publishedText)).toStrictEqual(renderClaTree(draftText));
  expect(renderClaHtml(publishedText)).toBe(renderClaHtml(draftText));
});

test('the HTML of a representative document is the one in the snapshot file', async () => {
  await expect(renderClaHtml(SAMPLE)).toMatchFileSnapshot('./snapshots/cla-markdown/sample-document.html');
});

const literalBlock = (tree: Root): { tag: string[]; text: string } => ({
  tag: tagsOf(tree),
  text: hastText(tree),
});

test('a text that nests 50 block quotes, bullets or list levels renders, and 51 are refused by validateClaText', () => {
  expect(CLA_MAX_NESTING).toBe(50);
  for (const make of [nestedQuotes, nestedBullets, indentedBullets]) {
    const deep = make(50);
    expect(validateClaText(deep), `${make.name} 50`).toBeNull();
    const tags = tagsOf(renderClaTree(deep));
    expect(tags.filter((tag) => tag === 'blockquote' || tag === 'ul')).toHaveLength(50);
    expect(tags).not.toContain('pre');
    expect(validateClaText(make(51)), `${make.name} 51`).toEqual({ rule: 'content_too_deeply_nested' });
  }
});

test.each([
  ['51 block quotes', nestedQuotes(51)],
  ['51 bullets opened on one line', nestedBullets(51)],
  ['51 lists nested by indentation', indentedBullets(51)],
  ['51 levels of emphasis and strong text', nestedEmphasis(51)],
  ['a line of 101 container markers', nestedQuotes(101)],
  ['a line of 101 ordered markers', `${'1. '.repeat(101)}x\n`],
])(
  'a text of %s is shown as one block of code with its own words, not interpreted and without a stack to overflow',
  (_label, text) => {
    expect(literalBlock(renderClaTree(text))).toEqual({ tag: ['pre', 'code'], text });
  },
);

test('50 levels of emphasis and strong text still render as emphasis', () => {
  const tags = tagsOf(renderClaTree(nestedEmphasis(50)));
  expect(tags.filter((tag) => tag === 'em' || tag === 'strong')).toHaveLength(50);
});

test('50 block quotes holding 50 levels of emphasis render without a stack overflow', () => {
  const both = `${'> '.repeat(50)}${nestedEmphasis(50)}`;
  const tags = tagsOf(renderClaTree(both));
  expect(tags.filter((tag) => tag === 'blockquote')).toHaveLength(50);
  expect(tags.filter((tag) => tag === 'em' || tag === 'strong')).toHaveLength(50);
});

test('a 100 KiB run of [ and a 100 KiB run of * render without a stack overflow', () => {
  const brackets = renderClaTree('['.repeat(102_400));
  expect(hastText(brackets)).toBe('['.repeat(102_400));
  const stars = renderClaTree('*'.repeat(102_400));
  expect(tagsOf(stars)).toEqual(['hr']);
  const spacedStars = renderClaTree('*a '.repeat(34_000));
  expect(hastText(spacedStars)).toBe('*a '.repeat(34_000).trimEnd());
});

test('a run of 100 KiB of > or - markers is shown as text at once', () => {
  expect(hastText(renderClaTree('> '.repeat(51_200)))).toBe('> '.repeat(51_200));
  expect(tagsOf(renderClaTree('- '.repeat(51_200)))).toEqual(['pre', 'code']);
});

test('the HTML of a hostile document has none of its markup and all of its words', () => {
  const html = renderClaHtml('<script>alert(1)</script> [x](javascript:alert(1)) ![y](http://t.example/p.png)\n');
  expect(html).toBe('<p>&#x3C;script>alert(1)&#x3C;/script> x y</p>');
});
