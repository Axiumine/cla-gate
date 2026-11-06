// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { HOSTILE_CLA_ROWS } from '../../../shared/test-support.ts';
import { expectNoA11yViolations } from '../../test-support/a11y.ts';
import { MarkdownView } from './MarkdownView.tsx';

// E18-S01: the component that draws a CLA text. The table of E12-S07 (hostile Markdown and HTML) goes through it, and what
// reaches the page is checked in the DOM, which is what a signer's browser would run.

/** Every element a drawn CLA may hold: the elements of the sanitiser, the headings, and the wrapper of the component. */
const ALLOWED_TAGS = new Set([
  'div',
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
/** The attributes an element may carry besides `class`. */
const ALLOWED_ATTRIBUTES = new Map<string, readonly string[]>([
  ['a', ['href', 'rel', 'target']],
  ['ol', ['start']],
]);
const ALLOWED_ADDRESS = /^(?:https?:\/\/|mailto:)/;
const FORBIDDEN_TAGS = ['script', 'img', 'style', 'iframe', 'svg', 'object', 'embed', 'form', 'input', 'link', 'meta'];

/** Fails unless every element in `container` is allowed, has allowed attributes only, and every link is safe. */
function expectOnlySafeDom(container: HTMLElement): void {
  for (const element of container.querySelectorAll('*')) {
    const tag = element.tagName.toLowerCase();
    expect(ALLOWED_TAGS.has(tag), tag).toBe(true);
    for (const name of element.getAttributeNames()) {
      expect(['class', ...(ALLOWED_ATTRIBUTES.get(tag) ?? [])], `${tag}.${name}`).toContain(name);
    }
  }
  for (const link of container.querySelectorAll('a')) {
    expect(link.getAttribute('href') ?? '').toMatch(ALLOWED_ADDRESS);
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    expect(link).toHaveAttribute('target', '_blank');
  }
  for (const tag of FORBIDDEN_TAGS) {
    expect(container.querySelector(tag), tag).toBeNull();
  }
}

test.each(HOSTILE_CLA_ROWS)(
  'hostile input, %s: only safe elements and attributes reach the DOM, and what was refused is shown as text',
  (_label, source, shown) => {
    const { container } = render(<MarkdownView source={source} />);
    expectOnlySafeDom(container);
    expect(container.textContent).toContain(shown);
  },
);

test('the raw script, the image with an onerror handler, the javascript: and data: links and the nested HTML leave nothing active', () => {
  const source = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '[x](javascript:alert(1))',
    '[y](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
    '<div><p onclick="x()"><b>nested</b></p></div>',
  ].join('\n\n');
  const { container } = render(<MarkdownView source={source} />);
  expect(container.querySelectorAll('script, img, [onerror], [onclick]')).toHaveLength(0);
  expect([...container.querySelectorAll('[href]')].map((link) => link.getAttribute('href'))).toEqual([]);
  expect(container.textContent).toContain('<script>alert(1)</script>');
  expect(container.textContent).toContain('<div><p onclick="x()"><b>nested</b></p></div>');
});

test('the placeholder <company name> stays visible as text', () => {
  const { container } = render(<MarkdownView source="This agreement is with <company name> and you." />);
  expect(container).toHaveTextContent('This agreement is with <company name> and you.');
  expect(container.querySelector('company')).toBeNull();
});

test('a safe link is a link that opens in a new tab with no opener, no referrer and no weight for search engines', () => {
  render(<MarkdownView source="[the terms](https://example.org/terms) and [mail](mailto:legal@example.org)" />);
  const terms = screen.getByRole('link', { name: 'the terms' });
  expect(terms).toHaveAttribute('href', 'https://example.org/terms');
  expect(terms).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  expect(terms).toHaveAttribute('target', '_blank');
  expect(screen.getByRole('link', { name: 'mail' })).toHaveAttribute('href', 'mailto:legal@example.org');
});

test('an image is its alternative text', () => {
  const { container } = render(<MarkdownView source="![the logo](https://example.org/logo.png)" />);
  expect(container.querySelector('img')).toBeNull();
  expect(container).toHaveTextContent('the logo');
});

test('the headings of the text are shown one level below the page heading, and none goes past h6', () => {
  render(<MarkdownView source={'# One\n\n## Two\n\n##### Five\n\n###### Six'} />);
  expect(screen.getByRole('heading', { name: 'One' }).tagName).toBe('H2');
  expect(screen.getByRole('heading', { name: 'Two' }).tagName).toBe('H3');
  expect(screen.getByRole('heading', { name: 'Five' }).tagName).toBe('H6');
  expect(screen.getByRole('heading', { name: 'Six' }).tagName).toBe('H6');
  expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
});

test('the top level of the headings is a prop of the component', () => {
  render(<MarkdownView source={'# One\n\n## Two'} headingLevel={3} />);
  expect(screen.getByRole('heading', { name: 'One' }).tagName).toBe('H3');
  expect(screen.getByRole('heading', { name: 'Two' }).tagName).toBe('H4');
});

test('lists, quotes, code, emphasis and rules are drawn as the elements they are', () => {
  const source = [
    '1. first',
    '2. second',
    '',
    '- apple',
    '- pear',
    '',
    '> quoted',
    '',
    '    indented code',
    '',
    'with `inline`, *em* and **strong**',
    '',
    '---',
    '',
    'line one  ',
    'line two',
  ].join('\n');
  const { container } = render(<MarkdownView source={source} />);
  expect(screen.getAllByRole('list')).toHaveLength(2);
  expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['first', 'second', 'apple', 'pear']);
  expect(container.querySelector('blockquote')).toHaveTextContent('quoted');
  expect(container.querySelector('pre > code')).toHaveTextContent('indented code');
  expect(container.querySelector('p code')).toHaveTextContent('inline');
  expect(container.querySelector('em')).toHaveTextContent('em');
  expect(container.querySelector('strong')).toHaveTextContent('strong');
  expect(container.querySelector('hr')).not.toBeNull();
  expect(container.querySelector('br')).not.toBeNull();
});

test('an ordered list that starts at 3 starts at 3, and one that starts at 1 says nothing', () => {
  const { container, rerender } = render(<MarkdownView source={'3. three\n4. four'} />);
  expect(container.querySelector('ol')).toHaveAttribute('start', '3');
  rerender(<MarkdownView source={'1. one\n2. two'} />);
  expect(container.querySelector('ol')).not.toHaveAttribute('start');
});

test('a text that changes is drawn again', () => {
  const { container, rerender } = render(<MarkdownView source="first text" />);
  expect(container).toHaveTextContent('first text');
  rerender(<MarkdownView source="second text" />);
  expect(container).toHaveTextContent('second text');
  expect(container).not.toHaveTextContent('first text');
});

test('an empty text draws an empty wrapper', () => {
  const { container } = render(<MarkdownView source="" />);
  expect(container.querySelectorAll('*')).toHaveLength(1);
});

test('a drawn CLA with headings, lists, links and code passes axe', async () => {
  const { container } = render(
    <MarkdownView
      source={'# Terms\n\n## Grant\n\nSee [the site](https://example.org).\n\n- a\n- b\n\n```\ncode\n```'}
    />,
  );
  await expectNoA11yViolations(container);
});
