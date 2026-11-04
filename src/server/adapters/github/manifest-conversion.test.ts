// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { inspect } from 'node:util';
import { afterEach, expect, test, vi } from 'vitest';
import { ManifestConversionFailure } from '../../services/ports/manifest-conversion.ts';
import { FAKE_CODE, fakeManifestGithub, MADE_UP_APP } from '../http/setup-convert-fixture/test-support.ts';
import { CONVERSION_TIMEOUT_MS, createManifestConversion } from './manifest-conversion.ts';

// E19-S11: the adapter that trades GitHub's one-time code for the App's credentials. `fetch` is injected, the call is a POST
// with no Authorization and a ten-second timeout, the answer is parsed with zod, and nothing GitHub says reaches an error.

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** What the real `201` carries, with the fields the setup does not read. */
function githubAnswer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: MADE_UP_APP.id,
    slug: MADE_UP_APP.slug,
    node_id: 'MDM6QXBw',
    owner: { login: 'someone', id: 1 },
    html_url: MADE_UP_APP.htmlUrl,
    client_id: MADE_UP_APP.clientId,
    client_secret: MADE_UP_APP.clientSecret,
    webhook_secret: MADE_UP_APP.webhookSecret,
    pem: MADE_UP_APP.pem,
    ...overrides,
  };
}

/** An injected `fetch` that answers with `response` and keeps the calls it received. */
function fetchAnswering(response: Response | (() => Promise<Response>)) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const injected: typeof fetch = (input, init) => {
    calls.push({ url: input instanceof Request ? input.url : String(input), init });
    return typeof response === 'function' ? response() : Promise.resolve(response);
  };
  return { calls, fetch: injected };
}

const created = (body: unknown = githubAnswer()): Response => Response.json(body, { status: 201 });

/** What `convert` ended with: the error it threw, or a marker when it returned. */
function thrown(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => 'it returned',
    (error: unknown) => error,
  );
}

/** Every way an error can show what it holds: its message, its stack, its own properties and its cause. */
const everything = (error: unknown): string => inspect(error, { depth: 5 });

test('the limit of the call is ten seconds, spelled out here on purpose', () => {
  expect(CONVERSION_TIMEOUT_MS).toBe(10_000);
});

test('it POSTs to the conversion address of the code, with GitHub media type and API version and no Authorization', async () => {
  const { calls, fetch: injected } = fetchAnswering(created());
  await createManifestConversion({ fetch: injected }).convert('abc123');
  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toBe('https://api.github.com/app-manifests/abc123/conversions');
  const init = calls[0]?.init;
  expect(init?.method).toBe('POST');
  const headers = new Headers(init?.headers);
  expect(headers.get('accept')).toBe('application/vnd.github+json');
  expect(headers.get('x-github-api-version')).toBe('2022-11-28');
  expect(headers.get('user-agent')).toMatch(/^cla-gate\/\d+\.\d+\.\d+/u);
  expect(headers.has('authorization')).toBe(false);
  expect(init?.body).toBeUndefined();
});

test('a redirect is refused, so the answer is never read from anywhere but api.github.com', async () => {
  const { calls, fetch: injected } = fetchAnswering(created());
  await createManifestConversion({ fetch: injected }).convert('abc123');
  expect(calls[0]?.init?.redirect).toBe('error');
});

test('the code is put in the path as one segment: a code with a slash or dots cannot reach another address', async () => {
  const { calls, fetch: injected } = fetchAnswering(created());
  await createManifestConversion({ fetch: injected }).convert('../../x?y#z');
  expect(calls[0]?.url).toBe('https://api.github.com/app-manifests/..%2F..%2Fx%3Fy%23z/conversions');
});

test('the answer becomes the credentials of the setup contract, and the fields the setup does not read are dropped', async () => {
  const { fetch: injected } = fetchAnswering(created());
  expect(await createManifestConversion({ fetch: injected }).convert('abc123')).toEqual({
    appId: MADE_UP_APP.id,
    slug: MADE_UP_APP.slug,
    htmlUrl: MADE_UP_APP.htmlUrl,
    installUrl: `https://github.com/apps/${MADE_UP_APP.slug}/installations/new`,
    clientId: MADE_UP_APP.clientId,
    clientSecret: MADE_UP_APP.clientSecret,
    webhookSecret: MADE_UP_APP.webhookSecret,
    privateKeyPem: MADE_UP_APP.pem,
  });
});

test('the install address is built from the slug alone, and a slug is one path segment in it', async () => {
  const { fetch: injected } = fetchAnswering(created(githubAnswer({ slug: 'a/b?c' })));
  const credentials = await createManifestConversion({ fetch: injected }).convert('abc123');
  expect(credentials.installUrl).toBe('https://github.com/apps/a%2Fb%3Fc/installations/new');
});

test('the global fetch is used when none is injected, and it is read when the call is made', async () => {
  const calls: string[] = [];
  const conversion = createManifestConversion();
  vi.stubGlobal('fetch', (url: string) => {
    calls.push(url);
    return Promise.resolve(created());
  });
  await conversion.convert('abc123');
  expect(calls).toEqual(['https://api.github.com/app-manifests/abc123/conversions']);
});

test('the call ends after the timeout it is given, and the default is ten seconds', async () => {
  const timeout = vi.spyOn(AbortSignal, 'timeout');
  const { fetch: injected } = fetchAnswering(() => Promise.resolve(created()));
  await createManifestConversion({ fetch: injected }).convert('abc123');
  await createManifestConversion({ fetch: injected, timeoutMs: 1234 }).convert('abc123');
  expect(timeout.mock.calls).toEqual([[10_000], [1234]]);
});

test('a GitHub that does not answer in time is unreachable', async () => {
  const hung = vi.fn(
    (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('timed out', 'TimeoutError'));
        });
      }),
  );
  const error = await thrown(createManifestConversion({ fetch: hung, timeoutMs: 20 }).convert('abc'));
  expect(error).toMatchObject({ name: 'ManifestConversionFailure', reason: 'unreachable' });
});

test('a network error is unreachable, and what it said stays out of the failure', async () => {
  const broken = vi.fn(() => Promise.reject(new TypeError('connect ECONNREFUSED LEAKCANARY')));
  const error = await thrown(createManifestConversion({ fetch: broken }).convert('abc'));
  expect(error).toMatchObject({ reason: 'unreachable', message: 'The manifest conversion failed (unreachable)' });
  expect(error).not.toHaveProperty('cause');
  expect(everything(error)).not.toContain('LEAKCANARY');
});

test.each([
  [404, 'code_invalid'],
  [500, 'unreachable'],
  [502, 'unreachable'],
  [503, 'unreachable'],
  [599, 'unreachable'],
  [429, 'unreachable'],
  [400, 'unexpected_response'],
  [401, 'unexpected_response'],
  [403, 'unexpected_response'],
  [422, 'unexpected_response'],
  [418, 'unexpected_response'],
])('a %s from GitHub is %s, and the body of it is never read into the failure', async (status, reason) => {
  const body = { message: 'LEAKCANARY', client_secret: MADE_UP_APP.clientSecret };
  const { fetch: injected } = fetchAnswering(Response.json(body, { status }));
  const error = await thrown(createManifestConversion({ fetch: injected }).convert('abc'));
  expect(error).toBeInstanceOf(ManifestConversionFailure);
  expect(error).toMatchObject({ reason });
  expect(everything(error)).not.toContain('LEAKCANARY');
  expect(everything(error)).not.toContain(MADE_UP_APP.clientSecret);
});

test('an answer whose body breaks off is unreachable', async () => {
  const torn = new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new TypeError('terminated LEAKCANARY'));
      },
    }),
    { status: 201 },
  );
  const error = await thrown(createManifestConversion({ fetch: fetchAnswering(torn).fetch }).convert('abc'));
  expect(error).toMatchObject({ reason: 'unreachable' });
  expect(everything(error)).not.toContain('LEAKCANARY');
});

test('an answer that is not JSON is unexpected, and so is JSON that is not an object', async () => {
  const text = fetchAnswering(new Response('<html>LEAKCANARY</html>', { status: 201 }));
  const error = await thrown(createManifestConversion({ fetch: text.fetch }).convert('abc'));
  expect(error).toMatchObject({ reason: 'unexpected_response' });
  expect(everything(error)).not.toContain('LEAKCANARY');
  const list = fetchAnswering(created([MADE_UP_APP.id]));
  expect(await thrown(createManifestConversion({ fetch: list.fetch }).convert('abc'))).toMatchObject({
    reason: 'unexpected_response',
  });
});

test.each([
  ['no id', { id: undefined }],
  ['an id that is a string', { id: '987654' }],
  ['an id that is not a whole number', { id: 1.5 }],
  ['an id of zero', { id: 0 }],
  ['no slug', { slug: undefined }],
  ['an empty slug', { slug: '' }],
  ['no html_url', { html_url: undefined }],
  ['no client_id', { client_id: undefined }],
  ['an empty html_url', { html_url: '' }],
  ['an empty client_id', { client_id: '' }],
  ['an empty client_secret', { client_secret: '' }],
  ['an empty webhook_secret', { webhook_secret: '' }],
  ['an empty pem', { pem: '' }],
  ['a null webhook_secret', { webhook_secret: null }],
  ['no pem', { pem: undefined }],
  ['a pem that is a number', { pem: 7 }],
])('an answer with %s is unexpected', async (_what, overrides) => {
  const { fetch: injected } = fetchAnswering(created(githubAnswer(overrides)));
  const error = await thrown(createManifestConversion({ fetch: injected }).convert('abc'));
  expect(error).toMatchObject({
    reason: 'unexpected_response',
    message: 'The manifest conversion failed (unexpected_response)',
  });
});

test('over the real fetch against the fake GitHub a code works once, as the real one does, and an unknown code is a 404', async () => {
  const github = fakeManifestGithub();
  const conversion = createManifestConversion();
  expect(await conversion.convert(FAKE_CODE)).toMatchObject({
    appId: MADE_UP_APP.id,
    clientSecret: MADE_UP_APP.clientSecret,
  });
  expect(await thrown(conversion.convert(FAKE_CODE))).toMatchObject({ reason: 'code_invalid' });
  expect(await thrown(conversion.convert('someothercode'))).toMatchObject({ reason: 'code_invalid' });
  expect(github.requests.map((request) => request.method)).toEqual(['POST', 'POST', 'POST']);
});
