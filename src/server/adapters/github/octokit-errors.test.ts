// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { RequestError } from 'octokit';
import { expect, test, vi } from 'vitest';
import {
  GitHubForbiddenError,
  GitHubNotFoundError,
  GitHubRateLimitedError,
  GitHubUnavailableError,
  type RateLimitScope,
} from '../../services/ports/github-errors.ts';
import { captureLogs } from '../../test-support.ts';
import { createLogger } from '../http/logger.ts';
import { failureOf } from './octokit-errors.ts';
import { createOctokit } from './octokit-transport.ts';

const ROUTE = 'GET /repositories/{repository_id}';

/** 2026-11-02T10:00:00Z, in epoch milliseconds: the time the failures below are read at. */
const NOW = Date.parse('2026-11-02T10:00:00.000Z');
const NOW_SECONDS = NOW / 1000;

/** The error of a request that GitHub answered with `status`, the headers and `message` as its body. */
function answered(status: number, headers: Record<string, string>, message = 'no'): RequestError {
  const url = 'https://api.github.com/x';
  return new RequestError(message, status, {
    request: { method: 'GET', url, headers: {} },
    response: { status, url, headers, data: { message } },
  });
}

test('a RequestError with no response is an outage named by the system error under it, and keeps no cause', () => {
  const fetchFailed = new TypeError('fetch failed', {
    cause: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
  });
  const failure = failureOf(
    new RequestError('fetch failed', 500, { request: { method: 'GET', url: 'https://api.github.com/x', headers: {} } }),
    ROUTE,
    NOW,
  );
  expect(failure).toBeInstanceOf(GitHubUnavailableError);
  const wrapped = new RequestError('refused', 500, {
    request: { method: 'GET', url: 'https://api.github.com/x', headers: { authorization: 'Bearer ghs_leak' } },
  });
  wrapped.cause = fetchFailed;
  const named = failureOf(wrapped, ROUTE, NOW);
  expect(named.message).toBe('GitHub could not be reached (ECONNREFUSED)');
  expect(named.cause).toBeUndefined();
  expect(JSON.stringify(named) + String(named.stack)).not.toContain('ghs_leak');
});

test('an error that is not a RequestError (an aborted request, a plugin failure) is an outage too', () => {
  const aborted = Object.assign(new DOMException('aborted', 'AbortError'), { status: 500 });
  expect(failureOf(aborted, ROUTE, NOW)).toMatchObject({
    name: 'GitHubUnavailableError',
    message: 'GitHub could not be reached (AbortError)',
  });
  expect(failureOf('a string', ROUTE, NOW).message).toBe('GitHub could not be reached (unknown error)');
});

test("Octokit's own log lines go nowhere: they can carry a URL, which can carry an organisation's name", () => {
  const logs = captureLogs();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const octokit = createOctokit({
    fetch,
    timeoutMs: 1000,
    logger: createLogger({ logLevel: 'debug' }, logs.destination),
  });
  const message = 'https://api.github.com/orgs/secret-org/memberships/alice';
  octokit.log.debug(message);
  octokit.log.info(message);
  octokit.log.warn(message);
  octokit.log.error(message);
  expect(logs.text()).toBe('');
  expect(warn).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
});

const SECONDARY_TEXT = 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.';
const PRIMARY_TEXT = 'API rate limit exceeded for installation ID 11.';
const reset = (secondsFromNow: number): string => String(NOW_SECONDS + secondsFromNow);

interface Limit {
  readonly name: string;
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly message: string;
  readonly seconds: number;
  readonly scope: RateLimitScope;
}

/** A failed request (`status`, with `headers` and the `message` of its body) and the limit it must be read as. */
const limit = (
  name: string,
  answer: { status: number; headers?: Record<string, string>; message?: string },
  seconds: number,
  scope: RateLimitScope,
): Limit => ({
  name,
  status: answer.status,
  headers: answer.headers ?? {},
  message: answer.message ?? 'x',
  seconds,
  scope,
});

const USED_UP = { 'x-ratelimit-remaining': '0' };

const LIMITS: Limit[] = [
  limit('a 429 with retry-after', { status: 429, headers: { 'retry-after': '2' } }, 2, 'secondary'),
  limit('a 403 with retry-after', { status: 403, headers: { 'retry-after': '30' } }, 30, 'secondary'),
  limit(
    'a 403 with retry-after and a permission-sounding message',
    { status: 403, headers: { 'retry-after': '120' }, message: 'Forbidden' },
    120,
    'secondary',
  ),
  limit('a 429 with no header at all', { status: 429 }, 60, 'secondary'),
  limit('a 403 worded as a secondary limit, no header', { status: 403, message: SECONDARY_TEXT }, 60, 'secondary'),
  limit('a 403 worded as the primary limit, no header', { status: 403, message: PRIMARY_TEXT }, 60, 'secondary'),
  limit(
    'a 403 with the primary budget used up, reset in 10 s',
    { status: 403, headers: { ...USED_UP, 'x-ratelimit-reset': reset(10) } },
    10,
    'primary',
  ),
  limit(
    'a 429 with the primary budget used up, reset in 600 s',
    { status: 429, headers: { ...USED_UP, 'x-ratelimit-reset': reset(600) } },
    600,
    'primary',
  ),
  limit(
    'a reset that is already past is one second',
    { status: 403, headers: { ...USED_UP, 'x-ratelimit-reset': reset(-30) } },
    1,
    'primary',
  ),
  limit('a used-up budget with no reset time is a minute', { status: 403, headers: USED_UP }, 60, 'primary'),
  limit(
    'a used-up budget with a reset that is not a number',
    { status: 403, headers: { ...USED_UP, 'x-ratelimit-reset': 'soon' } },
    60,
    'primary',
  ),
  limit(
    'retry-after wins over the reset time',
    { status: 403, headers: { 'retry-after': '5', ...USED_UP, 'x-ratelimit-reset': reset(300) } },
    5,
    'primary',
  ),
  limit('retry-after 0 is one second', { status: 429, headers: { 'retry-after': '0' } }, 1, 'secondary'),
  limit(
    'retry-after that is a date is a minute',
    { status: 403, headers: { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' } },
    60,
    'secondary',
  ),
  limit('retry-after that is negative is a minute', { status: 429, headers: { 'retry-after': '-5' } }, 60, 'secondary'),
  limit(
    'retry-after that is a fraction is a minute',
    { status: 429, headers: { 'retry-after': '1.5' } },
    60,
    'secondary',
  ),
  limit(
    'retry-after of 11 digits is a minute',
    { status: 429, headers: { 'retry-after': '12345678901' } },
    60,
    'secondary',
  ),
  limit(
    'a reset of 10 digits far away is taken as it is',
    { status: 403, headers: { ...USED_UP, 'x-ratelimit-reset': '9999999999' } },
    9999999999 - NOW_SECONDS,
    'primary',
  ),
];

test.each(LIMITS)('$name is a GitHubRateLimitedError for $seconds s, scope $scope', (row) => {
  const failure = failureOf(answered(row.status, row.headers, row.message), ROUTE, NOW);
  expect(failure).toBeInstanceOf(GitHubRateLimitedError);
  expect(failure).toMatchObject({ retryAfterSeconds: row.seconds, scope: row.scope });
});

test('a reset that falls inside a second is rounded up to the next one', () => {
  const headers = { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset(10) };
  expect(failureOf(answered(403, headers), ROUTE, NOW + 800)).toMatchObject({ retryAfterSeconds: 10 });
  expect(failureOf(answered(403, headers), ROUTE, NOW + 1000)).toMatchObject({ retryAfterSeconds: 9 });
});

test.each([
  ['403 with a permission message and no limit header', 403, { 'x-ratelimit-remaining': '4999' }, GitHubForbiddenError],
  ['403 with no header', 403, {}, GitHubForbiddenError],
  ['404 even with the budget used up', 404, { 'x-ratelimit-remaining': '0', 'retry-after': '5' }, GitHubNotFoundError],
  ['500 with retry-after', 500, { 'retry-after': '5' }, GitHubUnavailableError],
  ['503 with the budget used up', 503, { 'x-ratelimit-remaining': '0' }, GitHubUnavailableError],
])('a %s is not a rate limit', (_name, status, headers, expected) => {
  expect(failureOf(answered(status, headers, 'Resource not accessible by integration'), ROUTE, NOW)).toBeInstanceOf(
    expected,
  );
});

test('the error of a rate limit is fixed text: the message of GitHub and the headers stay out of it', () => {
  const failure = failureOf(
    answered(429, { 'retry-after': '7', authorization: 'Bearer ghs_leak' }, 'LEAKED-BODY-TEXT'),
    ROUTE,
    NOW,
  );
  expect(failure.message).toBe('GitHub rate limit (secondary): retry after 7 s');
  expect(JSON.stringify(failure) + String(failure.stack)).not.toMatch(/LEAKED|ghs_/);
  expect(failure.cause).toBeUndefined();
});
