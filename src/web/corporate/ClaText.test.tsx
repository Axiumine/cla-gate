// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import { render, screen } from '@testing-library/react';
import type { Element, ElementContent, Root, Text } from 'hast';
import { expect, test } from 'vitest';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { activeContent } from '../test-support/hostile.ts';
import { ClaText, ClaTree } from './ClaText.tsx';

// E21-S02: the text of a CLA drawn from the sanitised tree of the shared pipeline, and the second line that holds if a tree carries more.

const element = (tagName: string, properties: Element['properties'], ...children: ElementContent[]): Element => ({
  type: 'element',
  tagName,
  properties,
  children,
});

const text = (value: string): Text => ({ type: 'text', value });

test('the text of a CLA is drawn as headings, paragraphs and lists, with its links opened as the pipeline says', async () => {
  const { container } = render(
    <ClaText
      markdown={'# Terms\n\nSee [the policy](https://example.org/policy) or <company name>.\n\n3. one\n4. two\n'}
    />,
  );
  expect(screen.getByRole('heading', { level: 1, name: 'Terms' })).toBeInTheDocument();
  const link = screen.getByRole('link', { name: 'the policy' });
  expect(link).toHaveAttribute('href', 'https://example.org/policy');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  expect(link).toHaveAttribute('target', '_blank');
  expect(screen.getByText(/<company name>/u)).toBeInTheDocument();
  expect(container.querySelector('ol')).toHaveAttribute('start', '3');
  expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['one', 'two']);
  await expectNoA11yViolations(container);
});

test('raw HTML, an image and links to script or data stay inert text', () => {
  const hostile = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '[x](javascript:alert(1))',
    '[y](data:text/html;base64,PHNjcmlwdD4=)',
    '![alt text](https://example.org/a.png)',
  ].join('\n\n');
  const { container } = render(<ClaText markdown={hostile} />);
  expect(activeContent(container)).toEqual([]);
  expect(container.querySelector('a')).toBeNull();
  expect(container.textContent).toContain('<script>alert(1)</script>');
  expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  expect(container.textContent).toContain('alt text');
});

test('a tree that carries a script, an image or a link to script draws as its text, and a comment draws as nothing', () => {
  const tree: Root = {
    type: 'root',
    children: [
      element('script', {}, text('alert(1)')),
      element('img', { src: 'x', onerror: 'alert(1)' }, text('picture')),
      element('p', {}, element('a', { href: 'javascript:alert(1)' }, text('click'))),
      element('p', {}, element('a', {}, text('no address'))),
      { type: 'comment', value: 'hidden' },
      { type: 'doctype' },
      element('ol', {}, element('li', {}, text('first'))),
    ],
  };
  const { container } = render(<ClaTree tree={tree} />);
  expect(activeContent(container)).toEqual([]);
  expect(container.querySelector('a')).toBeNull();
  expect(container.textContent).toBe('alert(1)picture' + 'click' + 'no address' + 'first');
  expect(container.querySelector('ol')).not.toHaveAttribute('start');
});
