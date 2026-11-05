// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { expectHostileNamesInert } from '../test-support/hostile.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { Heading, type HeadingLevel } from './Heading.tsx';

// E17-S07: Heading, the title whose level the caller chooses.

const LEVELS: readonly [HeadingLevel, string, string][] = [
  [1, 'H1', 'text-2xl'],
  [2, 'H2', 'text-xl'],
  [3, 'H3', 'text-lg'],
  [4, 'H4', 'text-base'],
  [5, 'H5', 'text-sm'],
  [6, 'H6', 'text-xs'],
];

test.each(LEVELS)('level %i is an %s element, drawn with %s', (level, tag, size) => {
  renderWithProviders(<Heading level={level}>Title</Heading>);
  const heading = screen.getByRole('heading', { level, name: 'Title' });
  expect(heading.tagName).toBe(tag);
  expect(heading).toHaveClass(size, 'font-semibold');
});

test('it is not focusable and not interactive', async () => {
  const { user } = renderWithProviders(
    <>
      <Heading level={2}>Title</Heading>
      <button type="button">Next</button>
    </>,
  );
  await user.tab();
  expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus();
});

test('a focusable heading can take focus from a script and is still not in the tab order (E18-S01)', async () => {
  const { user } = renderWithProviders(
    <>
      <Heading level={2} focusable>
        Done
      </Heading>
      <button type="button">Next</button>
    </>,
  );
  const heading = screen.getByRole('heading', { name: 'Done' });
  expect(heading).toHaveAttribute('tabindex', '-1');
  heading.focus();
  expect(heading).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus();
});

test('the ref is the heading element', () => {
  const seen: (HTMLHeadingElement | null)[] = [];
  renderWithProviders(
    <Heading
      level={3}
      ref={(element) => {
        seen.push(element);
      }}
    >
      Title
    </Heading>,
  );
  expect(seen[0]).toBe(screen.getByRole('heading', { level: 3 }));
});

test('a run of levels in order passes axe', async () => {
  const { container } = renderWithProviders(
    <>
      <Heading level={1}>One</Heading>
      <Heading level={2}>Two</Heading>
      <Heading level={3}>Three</Heading>
    </>,
  );
  await expectNoA11yViolations(container);
});

test('a hostile name in the title stays text', () => {
  expectHostileNamesInert((name) => renderWithProviders(<Heading level={2}>{name}</Heading>));
});
