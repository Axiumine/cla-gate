// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { inspect } from 'node:util';
import { delay, HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import { testGitHubKey } from '../../config/test-support.ts';
import {
  GitHubAuthError,
  GitHubRateLimitedError,
  GitHubResponseError,
  GitHubUnavailableError,
} from '../../services/ports/github-errors.ts';
import { FakeClock } from '../../services/test-support.ts';
import { fetchApp } from './app-api.ts';
import { appFixture, mockApp, START } from './test-support.ts';

/** What `check.verify()` rejects with, for a GitHub that answers every request with `answer`. */
async function failureOf(answer: () => Response | Promise<Response>, timeoutMs?: number): Promise<unknown> {
  const key = testGitHubKey();
  mockApp([key.publicKey], answer);
  const { check } = appFixture([key.key], timeoutMs);
  return check.verify().catch((error: unknown) => error);
}

test.each([
  [500, 'a body'],
  [502, 'no body'],
  [503, 'a body'],
  [403, 'a body'],
  [404, 'no body'],
])(
  'a %s answer (with %s) is an outage, not a verdict: GitHubUnavailableError naming the status',
  async (status, body) => {
    const answer = () =>
      body === 'a body' ? HttpResponse.json({ message: 'oops' }, { status }) : new HttpResponse(null, { status });
    const failure = await failureOf(answer);
    expect(failure).toBeInstanceOf(GitHubUnavailableError);
    expect(failure).toHaveProperty('message', `GitHub answered ${status} to GET /app`);
  },
);

test('a network failure is an outage and the message names the kind of failure', async () => {
  const key = testGitHubKey();
  mockApp([key.publicKey], () => HttpResponse.error());
  const failure: unknown = await appFixture([key.key])
    .check.verify()
    .catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(GitHubUnavailableError);
  expect(failure).toHaveProperty('message', 'GitHub could not be reached (TypeError)');
  expect(failure).not.toHaveProperty('cause');
});

test('an answer that never comes ends at the timeout, as an outage', async () => {
  const failure = await failureOf(async () => {
    await delay('infinite');
    return HttpResponse.json({});
  }, 40);
  expect(failure).toBeInstanceOf(GitHubUnavailableError);
  expect(failure).toHaveProperty('message', 'GitHub could not be reached (TimeoutError)');
});

test('a redirect is never followed, so the token cannot leave api.github.com: an outage', async () => {
  const failure = await failureOf(
    () => new HttpResponse(null, { status: 302, headers: { Location: 'https://evil.example/app' } }),
  );
  expect(failure).toBeInstanceOf(GitHubUnavailableError);
});

test('a 401 is a GitHubAuthError after every key was tried', async () => {
  const mismatch = testGitHubKey();
  mockApp([mismatch.publicKey]);
  const failure: unknown = await appFixture([testGitHubKey().key])
    .check.verify()
    .catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(GitHubAuthError);
});

test.each([
  ['text that is not JSON', 'not json at all'],
  ['an empty body', ''],
])('%s fails with a GitHubResponseError with no paths, and the text is not in the error', async (_name, text) => {
  const failure = await failureOf(() => new HttpResponse(text, { status: 200 }));
  expect(failure).toBeInstanceOf(GitHubResponseError);
  expect(failure).toMatchObject({ route: 'GET /app', paths: [] });
  expect(String(failure)).toBe("GitHubResponseError: GitHub's answer to GET /app is not what was expected (not JSON)");
});

test.each([['null'], ['[]'], ['"text"'], ['42']])('a body of %s fails at the body itself', async (json) => {
  const failure = await failureOf(() => new HttpResponse(json, { status: 200 }));
  expect(failure).toMatchObject({ route: 'GET /app', paths: ['(body)'] });
});

test('a body that is cut off halfway is an outage, not a bad answer', async () => {
  const broken = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"id":'));
      controller.error(new Error('connection reset'));
    },
  });
  const failure = await failureOf(() => new HttpResponse(broken, { status: 200 }));
  expect(failure).toBeInstanceOf(GitHubUnavailableError);
  expect(failure).toHaveProperty('message', 'GitHub could not be reached (UND_ERR_SOCKET)');
});

test('a hostile answer that echoes the token or secrets back never reaches the error, in any form of printing', async () => {
  const key = testGitHubKey();
  const route = mockApp([key.publicKey], () =>
    HttpResponse.json({ id: 'nope', owner: 'ghs_hostile-installation-token', echo: 'Bearer eyJ-hostile' }),
  );
  const failure: unknown = await appFixture([key.key])
    .check.verify()
    .catch((error: unknown) => error);
  const printed = [String(failure), inspect(failure, { depth: 6 }), JSON.stringify(failure)].join('\n');
  expect(printed).not.toContain('ghs_hostile');
  expect(printed).not.toContain('eyJ-hostile');
  expect(printed).not.toContain(route.tokens[0] ?? 'missing');
  expect(failure).toMatchObject({ paths: ['id', 'slug', 'owner', 'permissions'] });
});

test('a body that breaks off while it is read is an outage, with no trace of what had arrived', async () => {
  const broken = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"id":4242,"secret":"half-a-body"'));
      controller.error(new Error('connection reset: half-a-body'));
    },
  });
  const failure: unknown = await fetchApp(
    () => Promise.resolve(new Response(broken, { status: 200 })),
    'jwt',
    1000,
    new FakeClock(START),
  ).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(GitHubUnavailableError);
  expect(failure).toHaveProperty('message', 'GitHub could not be reached (Error)');
});

/** Rejects with anything at all, as a fetch implementation can. */
// eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the point of the test: the reason is not an Error
const rejectWith = (reason: unknown): Promise<never> => Promise.reject(reason);

test.each([
  ['a string', 'boom', 'unknown error'],
  ['an error without a cause', new RangeError('boom'), 'RangeError'],
  ['an error whose cause has no system code', new TypeError('boom', { cause: new Error('inner') }), 'TypeError'],
  [
    'an error whose cause code is not text',
    new TypeError('boom', { cause: Object.assign(new Error('x'), { code: 7 }) }),
    'TypeError',
  ],
])('a request that fails with %s is an outage named by %s', async (_name, thrown, named) => {
  const failure: unknown = await fetchApp(() => rejectWith(thrown), 'jwt', 1000, new FakeClock(START)).catch(
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(GitHubUnavailableError);
  expect(failure).toHaveProperty('message', `GitHub could not be reached (${named})`);
});

test.each([
  ['a 429 with no header: the minute GitHub advises', { status: 429 }, 60, 'secondary'],
  ['a 429 with retry-after', { status: 429, headers: { 'retry-after': '7' } }, 7, 'secondary'],
  ['a 403 with retry-after', { status: 403, headers: { 'retry-after': '30' } }, 30, 'secondary'],
  [
    'a 403 whose budget is used up, reset in 20 s',
    {
      status: 403,
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Date.parse(START) / 1000 + 20) },
    },
    20,
    'primary',
  ],
])('%s is a rate limit: GitHubRateLimitedError with the wait and the scope', async (_name, answer, wait, scope) => {
  const failure: unknown = await fetchApp(
    () => Promise.resolve(new Response('{}', answer)),
    'jwt',
    1000,
    new FakeClock(START),
  ).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(GitHubRateLimitedError);
  expect(failure).toMatchObject({ retryAfterSeconds: wait, scope });
});

test('a 403 that is not a limit is an outage-class failure, like any other status', async () => {
  const failure: unknown = await fetchApp(
    () => Promise.resolve(new Response('{}', { status: 403 })),
    'jwt',
    1000,
    new FakeClock(START),
  ).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(GitHubUnavailableError);
  expect(failure).toHaveProperty('message', 'GitHub answered 403 to GET /app');
});
