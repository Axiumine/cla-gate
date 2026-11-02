// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { id } from '../../services/github-contract/test-support.ts';
import {
  GitHubAuthError,
  GitHubForbiddenError,
  GitHubNotFoundError,
  GitHubRateLimitedError,
  GitHubResponseError,
  GitHubUnavailableError,
  InstallationGoneError,
  InstallationNotAdmittedError,
  InstallationSuspendedError,
} from '../../services/ports/github-errors.ts';
import { ProbeBudgetExhaustedError } from '../../services/probe-budget.ts';
import { RoleLookupThrottledError } from '../../services/role-lookup-budget.ts';
import { AppError } from './errors.ts';
import { upstreamFailure } from './upstream-failure.ts';

// How a failure to learn a role is told to the client (E11-S04): the table, without a server.

test('an outage, or no answer in time, is 502 github_unavailable and has no wait', () => {
  expect(
    upstreamFailure(new GitHubUnavailableError('GitHub did not answer a role lookup within 5000 ms')),
  ).toStrictEqual({
    status: 502,
    code: 'github_unavailable',
  });
});

test.each([
  [1, 1],
  [90, 90],
  [299, 299],
  [300, 300],
  [301, 300],
  [3600, 300],
  [Number.MAX_SAFE_INTEGER, 300],
])('a rate limit that asks for %s s is 503 github_rate_limited with a wait of %s s', (asked, told) => {
  expect(upstreamFailure(new GitHubRateLimitedError(asked, 'primary'))).toStrictEqual({
    status: 503,
    code: 'github_rate_limited',
    retryAfterSeconds: told,
  });
});

test('the secondary limit is told the same way as the primary', () => {
  expect(upstreamFailure(new GitHubRateLimitedError(30, 'secondary'))).toMatchObject({
    status: 503,
    retryAfterSeconds: 30,
  });
});

test('the person over their 30 lookups a minute is 429 too_many_requests with the wait until one is free', () => {
  expect(upstreamFailure(new RoleLookupThrottledError(42))).toStrictEqual({
    status: 429,
    code: 'too_many_requests',
    retryAfterSeconds: 42,
  });
});

test.each([
  ['a plain error', new Error('boom')],
  ['an AppError', new AppError(404, 'not_found')],
  ['refused credentials', new GitHubAuthError()],
  ['an answer that is not what was expected', new GitHubResponseError('GET /app', ['id'])],
  ['a 404 of GitHub', new GitHubNotFoundError('GET /app')],
  ['a 403 of GitHub', new GitHubForbiddenError('GET /app')],
  ['an installation that is gone', new InstallationGoneError(id(11))],
  ['an installation that is suspended', new InstallationSuspendedError(id(11))],
  ['an installation the instance does not serve', new InstallationNotAdmittedError('rejected')],
  ['a probe budget that is used up', new ProbeBudgetExhaustedError()],
  ['text', 'GitHub is down'],
  ['nothing', undefined],
])('%s is not an upstream failure: it is handled as any other error', (_name, error) => {
  expect(upstreamFailure(error)).toBeUndefined();
});
