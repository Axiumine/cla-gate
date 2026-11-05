// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { withGitHubDeadline } from './github-deadline.ts';
import { GitHubRateLimitedError, GitHubUnavailableError } from './ports/github-errors.ts';

// The deadline of the calls to GitHub that a person waits for (E11-S02, E15-S05): fake timers, so the boundary is exact and nothing sleeps.
// The deadline of the role lookups, which is this one with its own limit, is in role-deadline.test.ts.

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const LIMIT = { ms: 1500, what: 'a test call' };

test('work that has not settled at 1.499 s is still waited for, and fails at 1.5 s with a message that names the call and the limit', async () => {
  let outcome: unknown = 'pending';
  void withGitHubDeadline(() => new Promise<string>(() => undefined), LIMIT).catch((failure: unknown) => {
    outcome = failure;
  });
  await vi.advanceTimersByTimeAsync(1499);
  expect(outcome).toBe('pending');
  await vi.advanceTimersByTimeAsync(1);
  expect(outcome).toBeInstanceOf(GitHubUnavailableError);
  expect(String(outcome)).toBe('GitHubUnavailableError: GitHub did not answer a test call within 1500 ms');
});

test('work that settles in time resolves with its value and leaves no timer behind', async () => {
  await expect(withGitHubDeadline(() => Promise.resolve('found'), LIMIT)).resolves.toBe('found');
  expect(vi.getTimerCount()).toBe(0);
});

test('work that fails in time fails with its own error, and so does work that throws before it returns a promise', async () => {
  const failure = new GitHubRateLimitedError(30, 'primary');
  await expect(withGitHubDeadline(() => Promise.reject(failure), LIMIT)).rejects.toBe(failure);
  const thrown = new Error('thrown at once');
  await expect(
    withGitHubDeadline(() => {
      throw thrown;
    }, LIMIT),
  ).rejects.toBe(thrown);
  expect(vi.getTimerCount()).toBe(0);
});
