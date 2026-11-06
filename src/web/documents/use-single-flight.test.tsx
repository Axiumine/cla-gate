// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, test, vi } from 'vitest';
import { useSingleFlight } from './use-single-flight.ts';

// E18-S05: a double click, or an Enter key that repeats, sends one request; the guard is open again once the request has settled.

/** A hook over a real mutation whose request waits until the test lets it go. */
function setup() {
  const held: PromiseWithResolvers<string>[] = [];
  const request = vi.fn<(variables: string) => Promise<string>>(() => {
    const next = Promise.withResolvers<string>();
    held.push(next);
    return next.promise;
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
  );
  const view = renderHook(
    () => {
      const mutation = useMutation({ mutationFn: request });
      return { send: useSingleFlight(mutation), mutation };
    },
    { wrapper },
  );
  return { request, view, release: (index: number) => held.at(index)?.resolve('done') };
}

test('a second and a third send while the first is under way send nothing', async () => {
  const { request, view } = setup();
  act(() => {
    view.result.current.send('first');
    view.result.current.send('second');
    view.result.current.send('third');
  });
  await waitFor(() => {
    expect(view.result.current.mutation.isPending).toBe(true);
  });
  expect(request.mock.calls.map((call) => call[0])).toEqual(['first']);
});

test('once the request has settled the next send goes out', async () => {
  const { request, view, release } = setup();
  act(() => {
    view.result.current.send('first');
  });
  await waitFor(() => {
    expect(request).toHaveBeenCalledTimes(1);
  });
  release(0);
  await waitFor(() => {
    expect(view.result.current.mutation.isSuccess).toBe(true);
  });
  act(() => {
    view.result.current.send('second');
  });
  await waitFor(() => {
    expect(request).toHaveBeenCalledTimes(2);
  });
  expect(request.mock.calls.map((call) => call[0])).toEqual(['first', 'second']);
});

test('a reset while the request is under way (a field edited meanwhile) still opens the guard once the request has settled', async () => {
  const { request, view, release } = setup();
  act(() => {
    view.result.current.send('first');
  });
  await waitFor(() => {
    expect(request).toHaveBeenCalledTimes(1);
  });
  act(() => {
    view.result.current.mutation.reset();
  });
  release(0);
  await waitFor(() => {
    expect(view.result.current.mutation.isIdle).toBe(true);
  });
  act(() => {
    view.result.current.send('second');
  });
  await waitFor(() => {
    expect(request).toHaveBeenCalledTimes(2);
  });
  expect(request.mock.calls.map((call) => call[0])).toEqual(['first', 'second']);
});

test('a request that fails opens the guard too, and nothing is thrown at the caller', async () => {
  const request = vi.fn<(variables: string) => Promise<string>>(() => Promise.reject(new Error('refused')));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
  );
  const view = renderHook(
    () => {
      const mutation = useMutation({ mutationFn: request });
      return { send: useSingleFlight(mutation), mutation };
    },
    { wrapper },
  );
  act(() => {
    view.result.current.send('first');
  });
  await waitFor(() => {
    expect(view.result.current.mutation.isError).toBe(true);
  });
  act(() => {
    view.result.current.send('second');
  });
  await waitFor(() => {
    expect(request).toHaveBeenCalledTimes(2);
  });
});
