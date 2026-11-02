// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { expectHostileNamesInert } from '../test-support/hostile.ts';
import { UserText } from './UserText.tsx';

// E17-S09 (the first part of E17-S11): a string a person controls reaches the screen as a text node inside <bdi>.

test('the text sits in a bdi element that breaks a long word, as a text node and nothing else', () => {
  const { container } = render(<UserText>octocat</UserText>);
  const bdi = screen.getByText('octocat');
  expect(bdi.tagName).toBe('BDI');
  expect(bdi).toHaveClass('wrap-anywhere');
  expect([...bdi.childNodes].map((node) => node.nodeType)).toEqual([Node.TEXT_NODE]);
  expect(container.children).toHaveLength(1);
});

test('markup in the text is shown as the characters it is made of, and no element comes of it', () => {
  const { container } = render(<UserText>{'<img src=x onerror=alert(1)><b>bold</b>'}</UserText>);
  expect(container.querySelectorAll('img, b, script')).toHaveLength(0);
  expect(container).toHaveTextContent('<img src=x onerror=alert(1)><b>bold</b>');
});

test('every hostile name of the shared corpus stays inert text', () => {
  expectHostileNamesInert((name) => render(<UserText>{name}</UserText>));
});

test('it passes axe', async () => {
  const { container } = render(<UserText>octocat</UserText>);
  await expectNoA11yViolations(container);
});
