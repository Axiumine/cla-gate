// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { expectHostileNamesInert } from '../test-support/hostile.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { StatusMessage, type StatusTone } from './StatusMessage.tsx';

// E17-S06: StatusMessage, the polite live region that other primitives reuse to announce a change.

const TONES: readonly [StatusTone, string][] = [
  ['neutral', 'text-fg'],
  ['info', 'bg-info-bg'],
  ['success', 'bg-success-bg'],
  ['warning', 'bg-warning-bg'],
];

test('it is a role=status polite, atomic live region that shows its text', () => {
  renderWithProviders(<StatusMessage>3 signers</StatusMessage>);
  const region = screen.getByRole('status');
  expect(region).toHaveTextContent('3 signers');
  expect(region).toHaveAttribute('aria-live', 'polite');
  expect(region).toHaveAttribute('aria-atomic', 'true');
});

test.each(TONES)('the %s tone is drawn with %s', (tone, expected) => {
  renderWithProviders(<StatusMessage tone={tone}>Saved</StatusMessage>);
  expect(screen.getByRole('status')).toHaveClass(expected);
});

test('a message without a tone is neutral', () => {
  renderWithProviders(<StatusMessage>Saved</StatusMessage>);
  expect(screen.getByRole('status')).toHaveClass('text-fg');
});

test('visuallyHidden keeps the text for assistive technology and takes it off the screen', () => {
  renderWithProviders(<StatusMessage visuallyHidden>Page 2 of 5</StatusMessage>);
  const region = screen.getByRole('status');
  expect(region).toHaveClass('sr-only');
  expect(region).toHaveTextContent('Page 2 of 5');
  expect(region).not.toHaveClass('bg-info-bg');
});

test('the region stays in the page while its text changes, which is what makes a screen reader announce the change', () => {
  const { rerender } = renderWithProviders(<StatusMessage />);
  const region = screen.getByRole('status');
  expect(region).toBeEmptyDOMElement();
  rerender(<StatusMessage>Saved</StatusMessage>);
  expect(screen.getByRole('status')).toBe(region);
  expect(region).toHaveTextContent('Saved');
  rerender(<StatusMessage>Saved again</StatusMessage>);
  expect(screen.getByRole('status')).toBe(region);
  expect(region).toHaveTextContent('Saved again');
});

test('it is not interactive: Tab passes over it, and Enter, Space and Escape do nothing to it', async () => {
  const { user } = renderWithProviders(
    <>
      <StatusMessage>Saved</StatusMessage>
      <button type="button">Next</button>
    </>,
  );
  await user.tab();
  expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus();
  await user.keyboard('{Enter}{Escape} ');
  expect(screen.getByRole('status')).toHaveTextContent('Saved');
});

test('every tone, shown and hidden, passes axe', async () => {
  const { container } = renderWithProviders(
    <>
      {TONES.map(([tone]) => (
        <StatusMessage key={tone} tone={tone}>
          {tone}
        </StatusMessage>
      ))}
      <StatusMessage visuallyHidden>Page 2</StatusMessage>
      <StatusMessage />
    </>,
  );
  await expectNoA11yViolations(container);
});

test('a hostile name in the message stays text', () => {
  expectHostileNamesInert((name) => renderWithProviders(<StatusMessage>{name}</StatusMessage>));
});
