// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { GitHubRateLimitedError, GitHubUnavailableError } from './ports/github-errors.ts';
import { ROLE_LOOKUP_TIMEOUT_MS, withRoleDeadline } from './role-deadline.ts';

// The deadline of the role lookups (E11-S02): fake timers, so the boundary is exact and nothing sleeps.

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** What a promise became, and whether it has settled yet. */
function watch<T>(work: Promise<T>): { settled: () => boolean; outcome: Promise<unknown> } {
  let done = false;
  const outcome = work.then(
    (value) => {
      done = true;
      return value;
    },
    (failure: unknown) => {
      done = true;
      return failure;
    },
  );
  return { settled: () => done, outcome };
}

test('the deadline is 5 seconds', () => {
  expect(ROLE_LOOKUP_TIMEOUT_MS).toBe(5000);
});

test('work that has not settled at 4.999 s is still waited for, and fails with GitHubUnavailableError at 5 s', async () => {
  const { settled, outcome } = watch(withRoleDeadline(new Promise<string>(() => undefined)));
  await vi.advanceTimersByTimeAsync(4999);
  expect(settled()).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(settled()).toBe(true);
  const failure = await outcome;
  expect(failure).toBeInstanceOf(GitHubUnavailableError);
  expect(String(failure)).toBe('GitHubUnavailableError: GitHub did not answer a role lookup within 5000 ms');
});

test('work that settles in time resolves with its value and leaves no timer behind', async () => {
  const answer = withRoleDeadline(Promise.resolve('admin'));
  await expect(answer).resolves.toBe('admin');
  expect(vi.getTimerCount()).toBe(0);
});

test('work that fails in time fails with its own error and leaves no timer behind', async () => {
  const failure = new GitHubRateLimitedError(30, 'primary');
  await expect(withRoleDeadline(Promise.reject(failure))).rejects.toBe(failure);
  expect(vi.getTimerCount()).toBe(0);
});

test('an answer or a failure that arrives after the deadline is dropped without a second settlement', async () => {
  const slow = Promise.withResolvers<string>();
  const { outcome } = watch(withRoleDeadline(slow.promise));
  await vi.advanceTimersByTimeAsync(ROLE_LOOKUP_TIMEOUT_MS);
  expect(await outcome).toBeInstanceOf(GitHubUnavailableError);
  slow.resolve('admin');
  await vi.advanceTimersByTimeAsync(1);
  expect(vi.getTimerCount()).toBe(0);

  const failing = new Promise<string>((_resolve, reject) => {
    setTimeout(() => {
      reject(new GitHubRateLimitedError(30, 'primary'));
    }, ROLE_LOOKUP_TIMEOUT_MS + 10);
  });
  const second = watch(withRoleDeadline(failing));
  await vi.advanceTimersByTimeAsync(ROLE_LOOKUP_TIMEOUT_MS + 10);
  expect(await second.outcome).toBeInstanceOf(GitHubUnavailableError);
});
