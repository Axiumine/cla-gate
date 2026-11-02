// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { act, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { ApiError } from '../api/errors.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { ErrorState } from './ErrorState.tsx';

// E17-S07: a 429 disables "Try again", counts down the seconds the server asked for, and enables the button at zero.

afterEach(() => {
  vi.useRealTimers();
});

const tooMany = (retryAfterSeconds?: number) =>
  new ApiError({ status: 429, code: 'too_many_requests', requestId: 'req-00000001', retryAfterSeconds });
const retry = () => screen.getByRole('button', { name: 'Try again' });
const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

test('a 429 disables the button and shows the seconds left, counting down to zero, where the button is enabled', () => {
  vi.useFakeTimers();
  const refetch = vi.fn();
  renderWithProviders(<ErrorState error={tooMany(3)} refetch={refetch} />);
  expect(retry()).toBeDisabled();
  expect(screen.getByText('You can try again in 3 seconds.')).toBeInTheDocument();
  advance(1000);
  expect(screen.getByText('You can try again in 2 seconds.')).toBeInTheDocument();
  expect(retry()).toBeDisabled();
  advance(1000);
  expect(screen.getByText('You can try again in 1 second.')).toBeInTheDocument();
  expect(retry()).toBeDisabled();
  advance(1000);
  expect(screen.queryByText(/You can try again in/)).toBeNull();
  expect(retry()).toBeEnabled();
  expect(screen.getByRole('alert')).toHaveTextContent('Too many requests');
});

test('a disabled button does nothing, and the enabled one calls refetch', () => {
  vi.useFakeTimers();
  const refetch = vi.fn();
  renderWithProviders(<ErrorState error={tooMany(2)} refetch={refetch} />);
  act(() => {
    retry().click();
  });
  expect(refetch).not.toHaveBeenCalled();
  advance(2000);
  act(() => {
    retry().click();
  });
  expect(refetch).toHaveBeenCalledTimes(1);
});

test('the countdown stops at zero: no timer is left running', () => {
  vi.useFakeTimers();
  renderWithProviders(<ErrorState error={tooMany(1)} refetch={vi.fn()} />);
  expect(vi.getTimerCount()).toBe(1);
  advance(1000);
  expect(vi.getTimerCount()).toBe(0);
});

test('a tab that was throttled catches up: the clock decides, not the number of ticks', () => {
  vi.useFakeTimers();
  renderWithProviders(<ErrorState error={tooMany(10)} refetch={vi.fn()} />);
  vi.setSystemTime(Date.now() + 7000);
  advance(1000);
  expect(screen.getByText('You can try again in 2 seconds.')).toBeInTheDocument();
});

test.each([
  ['asks for no wait', tooMany(0)],
  ['sends no Retry-After', tooMany()],
  ['is a different error', new ApiError({ status: 503, code: 'service_unavailable', retryAfterSeconds: 30 })],
])('a 429 that %s, or any other error, leaves the button enabled and starts no timer', (_what, error) => {
  vi.useFakeTimers();
  renderWithProviders(<ErrorState error={error} refetch={vi.fn()} />);
  expect(retry()).toBeEnabled();
  expect(screen.queryByText(/You can try again in/)).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

test('a new 429 in the same place starts a new wait', () => {
  vi.useFakeTimers();
  const { rerender } = renderWithProviders(<ErrorState error={tooMany(2)} refetch={vi.fn()} />);
  advance(2000);
  expect(retry()).toBeEnabled();
  rerender(<ErrorState error={tooMany(5)} refetch={vi.fn()} />);
  expect(retry()).toBeDisabled();
  expect(screen.getByText('You can try again in 5 seconds.')).toBeInTheDocument();
  advance(1000);
  expect(screen.getByText('You can try again in 4 seconds.')).toBeInTheDocument();
});

test('the countdown is not announced every second: it sits in a region that is not live', () => {
  vi.useFakeTimers();
  renderWithProviders(<ErrorState error={tooMany(3)} refetch={vi.fn()} />);
  expect(screen.getByText('You can try again in 3 seconds.')).toHaveAttribute('aria-live', 'off');
});

test('while waiting, and after, the state passes axe', async () => {
  const { container } = renderWithProviders(<ErrorState error={tooMany(1)} refetch={vi.fn()} />);
  await expectNoA11yViolations(container);
  await vi.waitFor(
    () => {
      expect(retry()).toBeEnabled();
    },
    { timeout: 2500 },
  );
  await expectNoA11yViolations(container);
});
