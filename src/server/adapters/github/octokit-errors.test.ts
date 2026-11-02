// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { RequestError } from 'octokit';
import { expect, test, vi } from 'vitest';
import { GitHubUnavailableError } from '../../services/ports/github-errors.ts';
import { captureLogs } from '../../test-support.ts';
import { createLogger } from '../http/logger.ts';
import { failureOf } from './octokit-errors.ts';
import { createOctokit } from './octokit-transport.ts';

const ROUTE = 'GET /repositories/{repository_id}';

test('a RequestError with no response is an outage named by the system error under it, and keeps no cause', () => {
  const fetchFailed = new TypeError('fetch failed', {
    cause: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
  });
  const failure = failureOf(
    new RequestError('fetch failed', 500, { request: { method: 'GET', url: 'https://api.github.com/x', headers: {} } }),
    ROUTE,
  );
  expect(failure).toBeInstanceOf(GitHubUnavailableError);
  const wrapped = new RequestError('refused', 500, {
    request: { method: 'GET', url: 'https://api.github.com/x', headers: { authorization: 'Bearer ghs_leak' } },
  });
  wrapped.cause = fetchFailed;
  const named = failureOf(wrapped, ROUTE);
  expect(named.message).toBe('GitHub could not be reached (ECONNREFUSED)');
  expect(named.cause).toBeUndefined();
  expect(JSON.stringify(named) + String(named.stack)).not.toContain('ghs_leak');
});

test('an error that is not a RequestError (an aborted request, a plugin failure) is an outage too', () => {
  const aborted = Object.assign(new DOMException('aborted', 'AbortError'), { status: 500 });
  expect(failureOf(aborted, ROUTE)).toMatchObject({
    name: 'GitHubUnavailableError',
    message: 'GitHub could not be reached (AbortError)',
  });
  expect(failureOf('a string', ROUTE).message).toBe('GitHub could not be reached (unknown error)');
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
