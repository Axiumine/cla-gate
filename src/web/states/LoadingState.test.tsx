// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { act, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { LoadingState, SPINNER_DELAY_MS } from './LoadingState.tsx';

// E17-S07: LoadingState. A status with hidden text at once, a spinner only after 200 ms, and no change of focus.

afterEach(() => {
  vi.useRealTimers();
});

const spinner = (container: HTMLElement) => container.querySelector('[data-spinner]');
const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

test('the delay is 200 ms', () => {
  expect(SPINNER_DELAY_MS).toBe(200);
});

test('it is a role=status whose text comes from the catalog and is visually hidden', () => {
  renderWithProviders(<LoadingState />);
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('Loading');
  expect(screen.getByText('Loading')).toHaveClass('sr-only');
});

test('there is no spinner at first, none at 199 ms, and one at 200 ms; it is decoration for assistive technology', () => {
  vi.useFakeTimers();
  const { container } = renderWithProviders(<LoadingState />);
  expect(spinner(container)).toBeNull();
  advance(199);
  expect(spinner(container)).toBeNull();
  advance(1);
  expect(spinner(container)).toHaveAttribute('aria-hidden', 'true');
  expect(spinner(container)).toHaveClass('animate-spin');
  expect(screen.getByRole('status')).toHaveTextContent('Loading');
});

test('a response at 100 ms never flashes a spinner: the state is gone before the delay, and no spinner is ever added', () => {
  vi.useFakeTimers();
  const added: string[] = [];
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLElement && node.matches('[data-spinner]')) {
          added.push(node.outerHTML);
        }
      }
    }
  });
  const { container, rerender } = renderWithProviders(<LoadingState />);
  observer.observe(container, { childList: true, subtree: true });
  advance(100);
  rerender(<p>The data</p>);
  advance(1000);
  observer.takeRecords();
  observer.disconnect();
  expect(added).toEqual([]);
  expect(spinner(container)).toBeNull();
  expect(screen.getByText('The data')).toBeInTheDocument();
});

test('the timer dies with the state: nothing is left pending after it unmounts', () => {
  vi.useFakeTimers();
  const { unmount } = renderWithProviders(<LoadingState />);
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

test('it is not interactive and takes no focus: Tab passes over it, and focus stays where it was when it comes and goes', async () => {
  const { user, rerender } = renderWithProviders(
    <>
      <button type="button">Before</button>
      <LoadingState />
    </>,
  );
  await user.tab();
  expect(screen.getByRole('button', { name: 'Before' })).toHaveFocus();
  rerender(
    <>
      <button type="button">Before</button>
      <p>The data</p>
    </>,
  );
  expect(screen.getByRole('button', { name: 'Before' })).toHaveFocus();
  await user.keyboard('{Escape}');
  await user.tab();
  expect(document.body).toHaveFocus();
});

test('without and with the spinner it passes axe', async () => {
  const { container } = renderWithProviders(<LoadingState />);
  await expectNoA11yViolations(container);
  await vi.waitFor(() => {
    expect(spinner(container)).not.toBeNull();
  });
  await expectNoA11yViolations(container);
});
