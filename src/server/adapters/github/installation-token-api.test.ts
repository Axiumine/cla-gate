// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { inspect } from 'node:util';
import { delay, HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { testGitHubKey } from '../../config/test-support.ts';
import {
  GitHubAuthError,
  GitHubResponseError,
  GitHubUnavailableError,
  InstallationGoneError,
  InstallationSuspendedError,
} from '../../services/ports/github-errors.ts';
import { mintInstallationToken } from './installation-token-api.ts';
import { decodeJwt, jwtSignedBy, type MintAnswer, mockGitHub, tokenBody, tokensFixture } from './test-support.ts';

const key = testGitHubKey();
const INSTALLATION = parseGithubId(777);
const EXPIRES = new Date('2026-11-02T11:00:00.000Z');

/** What `mintInstallationToken` resolves or rejects with when GitHub answers every token request with `answer`. */
async function outcome(answer: MintAnswer, timeoutMs = 5000): Promise<unknown> {
  mockGitHub([key.publicKey], { mint: answer });
  const jwt = tokensFixture([key.key]).auth.createJwt();
  return mintInstallationToken(fetch, jwt, INSTALLATION, timeoutMs).then(
    (minted) => minted,
    (error: unknown) => error,
  );
}

const issued = () => HttpResponse.json(tokenBody('ghs_made-up-token', EXPIRES), { status: 201 });

test('it posts to the installation, signed as the App, with no body, and keeps only the token and its expiry', async () => {
  const routes = mockGitHub([key.publicKey], { mint: issued });
  const jwt = tokensFixture([key.key]).auth.createJwt();
  const minted = await mintInstallationToken(fetch, jwt, INSTALLATION, 5000);
  expect(minted).toEqual({ token: 'ghs_made-up-token', expires_at: '2026-11-02T11:00:00Z' });
  expect(routes.mints).toHaveLength(1);
  const [call] = routes.mints;
  expect(call?.installationId).toBe('777');
  expect(call?.body).toBe('');
  expect(call?.jwt).toBe(jwt);
  expect(jwtSignedBy(call?.jwt ?? '', key.publicKey)).toBe(true);
  expect(decodeJwt(call?.jwt ?? '').claims).toMatchObject({ iss: '4242' });
});

test('the request carries the GitHub headers and no content type, since it has no body', async () => {
  const routes = mockGitHub([key.publicKey], { mint: issued });
  await mintInstallationToken(fetch, tokensFixture([key.key]).auth.createJwt(), INSTALLATION, 5000);
  const headers = routes.mints[0]?.headers;
  expect(headers?.get('x-github-api-version')).toBe('2022-11-28');
  expect(headers?.get('accept')).toBe('application/vnd.github+json');
  expect(headers?.get('user-agent')).toBe('cla-gate');
  expect(headers?.get('content-type')).toBeNull();
});

test('an expiry with a UTC offset or fractions of a second names one instant too, and is accepted', async () => {
  const failure = await outcome(() =>
    HttpResponse.json({ token: 'ghs_made-up-token', expires_at: '2026-11-02T12:00:00.250+01:00' }, { status: 201 }),
  );
  expect(failure).toEqual({ token: 'ghs_made-up-token', expires_at: '2026-11-02T12:00:00.250+01:00' });
});

test('a 404 means the installation is gone: InstallationGoneError naming its id', async () => {
  const failure = await outcome(() => HttpResponse.json({ message: 'Not Found' }, { status: 404 }));
  expect(failure).toBeInstanceOf(InstallationGoneError);
  expect(failure).toMatchObject({ githubInstallationId: 777, message: 'GitHub installation 777 no longer exists' });
});

test('a 404 without a body is the same', async () => {
  expect(await outcome(() => new HttpResponse(null, { status: 404 }))).toBeInstanceOf(InstallationGoneError);
});

test.each([
  ['This installation has been suspended'],
  ['Installation suspended'],
  ['THIS INSTALLATION HAS BEEN SUSPENDED'],
])('a 403 that says %j is InstallationSuspendedError', async (message) => {
  const failure = await outcome(() =>
    HttpResponse.json({ message, documentation_url: 'https://docs' }, { status: 403 }),
  );
  expect(failure).toBeInstanceOf(InstallationSuspendedError);
  expect(failure).toMatchObject({ githubInstallationId: 777, message: 'GitHub installation 777 is suspended' });
});

test.each([
  ['a message about something else', () => HttpResponse.json({ message: 'Resource not accessible' }, { status: 403 })],
  ['a body without a message', () => HttpResponse.json({ error: 'suspended' }, { status: 403 })],
  ['a message that is not text', () => HttpResponse.json({ message: ['suspended'] }, { status: 403 })],
  ['text that is not JSON', () => new HttpResponse('installation suspended', { status: 403 })],
  ['no body', () => new HttpResponse(null, { status: 403 })],
])('a 403 with %s is an outage-class failure, not a suspension', async (_name, answer) => {
  const failure = await outcome(answer);
  expect(failure).toBeInstanceOf(GitHubUnavailableError);
  expect(failure).toHaveProperty(
    'message',
    'GitHub answered 403 to POST /app/installations/{installation_id}/access_tokens',
  );
});

test('a 403 whose body breaks off while it is read is an outage, with no trace of what had arrived', async () => {
  const broken = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"message":"suspend'));
      controller.error(new Error('connection reset: suspend'));
    },
  });
  const failure: unknown = await mintInstallationToken(
    () => Promise.resolve(new Response(broken, { status: 403 })),
    'jwt',
    INSTALLATION,
    1000,
  ).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(GitHubUnavailableError);
  expect(failure).toHaveProperty('message', 'GitHub could not be reached (Error)');
});

test('a 401 is a GitHubAuthError', async () => {
  const other = testGitHubKey();
  mockGitHub([other.publicKey], { mint: issued });
  const jwt = tokensFixture([key.key]).auth.createJwt();
  const failure = await mintInstallationToken(fetch, jwt, INSTALLATION, 5000).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(GitHubAuthError);
});

test.each([
  [500, 'a body'],
  [502, 'no body'],
  [503, 'a body'],
  [422, 'a body'],
])('a %s answer (with %s) is GitHubUnavailableError naming the status and the route', async (status, body) => {
  const failure = await outcome(() =>
    body === 'a body'
      ? HttpResponse.json({ message: 'ghs_hostile-echo' }, { status })
      : new HttpResponse(null, { status }),
  );
  expect(failure).toBeInstanceOf(GitHubUnavailableError);
  expect(failure).toHaveProperty(
    'message',
    `GitHub answered ${status} to POST /app/installations/{installation_id}/access_tokens`,
  );
});

test('a network failure is an outage and the message names the kind of failure', async () => {
  const failure = await outcome(() => HttpResponse.error());
  expect(failure).toBeInstanceOf(GitHubUnavailableError);
  expect(failure).toHaveProperty('message', 'GitHub could not be reached (TypeError)');
  expect(failure).not.toHaveProperty('cause');
});

test('an answer that never comes ends at the timeout, as an outage', async () => {
  const failure = await outcome(async () => {
    await delay('infinite');
    return issued();
  }, 40);
  expect(failure).toBeInstanceOf(GitHubUnavailableError);
  expect(failure).toHaveProperty('message', 'GitHub could not be reached (TimeoutError)');
});

test('a redirect is never followed, so the JWT cannot leave api.github.com: an outage', async () => {
  const failure = await outcome(
    () => new HttpResponse(null, { status: 307, headers: { Location: 'https://evil.example/token' } }),
  );
  expect(failure).toBeInstanceOf(GitHubUnavailableError);
});

test.each([
  ['an empty token', { token: '', expires_at: '2026-11-02T11:00:00Z' }, ['token']],
  ['no token', { expires_at: '2026-11-02T11:00:00Z' }, ['token']],
  ['a token that is not text', { token: 12, expires_at: '2026-11-02T11:00:00Z' }, ['token']],
  ['no expiry', { token: 'ghs_hostile-token' }, ['expires_at']],
  ['an expiry that is not a date', { token: 'ghs_hostile-token', expires_at: 'in an hour' }, ['expires_at']],
  ['an expiry without a zone', { token: 'ghs_hostile-token', expires_at: '2026-11-02T11:00:00' }, ['expires_at']],
  ['an expiry in milliseconds', { token: 'ghs_hostile-token', expires_at: 1_793_617_200_000 }, ['expires_at']],
  ['nothing at all', {}, ['token', 'expires_at']],
])('%s fails with a GitHubResponseError naming the paths and no value', async (_name, body, paths) => {
  const failure = await outcome(() => HttpResponse.json(body, { status: 201 }));
  expect(failure).toBeInstanceOf(GitHubResponseError);
  expect(failure).toMatchObject({ route: 'POST /app/installations/{installation_id}/access_tokens', paths });
  const printed = [String(failure), inspect(failure, { depth: 6 }), JSON.stringify(failure)].join('\n');
  expect(printed).not.toContain('ghs_hostile');
  expect(printed).not.toContain('in an hour');
});

test.each([['null'], ['[]'], ['"ghs_hostile-token"']])('a body of %s fails at the body itself', async (json) => {
  const failure = await outcome(() => new HttpResponse(json, { status: 201 }));
  expect(failure).toMatchObject({ paths: ['(body)'] });
  expect(String(failure)).not.toContain('ghs_hostile');
});

test.each([
  ['text that is not JSON', 'ghs_hostile-token is not json'],
  ['an empty body', ''],
])('%s fails with a GitHubResponseError with no paths, and the text is not in the error', async (_name, text) => {
  const failure = await outcome(() => new HttpResponse(text, { status: 201 }));
  expect(failure).toBeInstanceOf(GitHubResponseError);
  expect(failure).toMatchObject({ paths: [] });
  expect(String(failure)).not.toContain('ghs_hostile');
});
