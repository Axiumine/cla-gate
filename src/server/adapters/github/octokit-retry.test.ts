// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { GitHubUnavailableError } from '../../services/ports/github-errors.ts';
import { captureLogs } from '../../test-support.ts';
import { createLogger } from '../http/logger.ts';
import { clientFixture, json, type RouteAnswer } from './client-fixture/test-support.ts';
import { guardedFetch } from './octokit-transport.ts';

/** Answers with `outcomes` in turn: a status, or the word `network` for a connection that fails; then 200 with `[]`. */
function sequence(...outcomes: (number | 'network')[]): RouteAnswer {
  const queue = [...outcomes];
  return () => {
    const next = queue.shift();
    if (next === 'network') {
      return Response.error();
    }
    return json(next === undefined || next < 400 ? [] : { message: 'try later' }, next ?? 200);
  };
}

test.each([
  ['a 502', [502]],
  ['a 503', [503]],
  ['a 504', [504]],
  ['a connection that fails', ['network']],
] as const)(
  'a GET that meets %s is repeated once, after 1 s, and its second answer is the result',
  async (_name, outcomes) => {
    const { client, calls, waits } = clientFixture({ 'GET /app/installations': sequence(...outcomes) });
    expect(await client.listInstallations()).toEqual([]);
    expect([calls.length, waits]).toEqual([2, [1000]]);
  },
);

test('a GET that fails twice is repeated twice, after 1 s and after 2 s', async () => {
  const { client, calls, waits } = clientFixture({ 'GET /app/installations': sequence(503, 'network') });
  expect(await client.listInstallations()).toEqual([]);
  expect([calls.length, waits]).toEqual([3, [1000, 2000]]);
});

test('three failures in a row end in GitHubUnavailableError: two repeats, never a third', async () => {
  const { client, calls, waits } = clientFixture({ 'GET /app/installations': sequence(502, 503, 504, 200) });
  await expect(client.listInstallations()).rejects.toThrow(
    new GitHubUnavailableError('GitHub answered 504 to GET /app/installations'),
  );
  expect([calls.length, waits]).toEqual([3, [1000, 2000]]);
});

test.each([
  [0, [1000, 2000]],
  [0.5, [1125, 2125]],
  [0.999, [1250, 2250]],
])('the jitter (random %s) adds between 0 and 250 ms to each wait: %j', async (random, expected) => {
  const { client, waits } = clientFixture({ 'GET /app/installations': sequence(502, 502) }, { random: () => random });
  await client.listInstallations();
  expect(waits).toEqual(expected);
});

test.each([[400], [401], [403], [404], [410], [422], [429], [500], [501]])(
  'a %s is a verdict, not an outage: it is sent once and never repeated',
  async (status) => {
    const { client, calls, waits } = clientFixture({ 'GET /app/installations': sequence(status, 200) });
    await client.listInstallations().catch(() => undefined);
    expect([calls.length, waits]).toEqual([1, []]);
  },
);

test('each repeat is one WARN with the attempt number, the reason and the wait, and nothing of the request', async () => {
  const { client, logs } = clientFixture({ 'GET /app/installations': sequence(502, 'network') });
  await client.listInstallations();
  const repeats = logs.lines().filter((entry) => entry['msg'] === 'github.request_repeated');
  expect(repeats.map((entry) => [entry['level'], entry['reason'], entry['waitMs']])).toEqual([
    [40, '502', 1000],
    [40, 'network', 2000],
  ]);
  expect(logs.text()).not.toMatch(/api\.github\.com|made-up-jwt|installations/);
});

// guardedFetch itself, with a `fetch` that is a script.

function scripted(...results: (Response | Error)[]): { send: typeof fetch; seen: RequestInit[] } {
  const seen: RequestInit[] = [];
  const queue = [...results];
  const send: typeof fetch = (_input, init) => {
    seen.push(init ?? {});
    const next = queue.shift() ?? new Response('ok');
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  return { send, seen };
}

const quiet = createLogger({ logLevel: 'silent' }, captureLogs().destination);

function guarded(send: typeof fetch) {
  return guardedFetch({ fetch: send, timeoutMs: 5000, logger: quiet, sleep: () => Promise.resolve(), random: () => 0 });
}

test.each([['POST'], ['PATCH'], ['PUT'], ['DELETE']])('a %s is never repeated after a 502', async (method) => {
  const { send, seen } = scripted(new Response('bad', { status: 502 }));
  const response = await guarded(send)('https://api.github.com/x', { method });
  expect(response.status).toBe(502);
  expect(seen).toHaveLength(1);
});

test.each([['POST'], ['PATCH'], ['PUT'], ['DELETE']])(
  'a %s is never repeated after a connection failure',
  async (method) => {
    const { send, seen } = scripted(new TypeError('fetch failed'), new Response('ok'));
    await expect(guarded(send)('https://api.github.com/x', { method })).rejects.toThrow('fetch failed');
    expect(seen).toHaveLength(1);
  },
);

test.each([['GET'], ['get']])('a %s given as text is repeated', async (method) => {
  const { send, seen } = scripted(new Response('bad', { status: 502 }));
  expect((await guarded(send)('https://api.github.com/x', { method })).status).toBe(200);
  expect(seen).toHaveLength(2);
});

test('a request with no method is a GET, and a Request object brings its own method', async () => {
  const get = scripted(new Response('bad', { status: 503 }));
  await guarded(get.send)('https://api.github.com/x');
  expect(get.seen).toHaveLength(2);
  const viaRequest = scripted(new Response('bad', { status: 503 }));
  await guarded(viaRequest.send)(new Request('https://api.github.com/x'));
  expect(viaRequest.seen).toHaveLength(2);
  const post = scripted(new Response('bad', { status: 503 }));
  await guarded(post.send)(new Request('https://api.github.com/x', { method: 'POST' }));
  expect(post.seen).toHaveLength(1);
});

test('every attempt refuses redirects and has its own timeout signal, whatever the caller asked for', async () => {
  const { send, seen } = scripted(new Response('bad', { status: 502 }));
  await guarded(send)('https://api.github.com/x', { method: 'GET', redirect: 'follow' });
  expect(seen.map((init) => init.redirect)).toEqual(['error', 'error']);
  expect(seen[0]?.signal).toBeInstanceOf(AbortSignal);
  expect(seen[1]?.signal).toBeInstanceOf(AbortSignal);
  expect(seen[0]?.signal).not.toBe(seen[1]?.signal);
});

test('without an injected sleep the wait is a real timer of 1 s plus jitter', async () => {
  vi.useFakeTimers();
  try {
    const { send, seen } = scripted(new Response('bad', { status: 502 }));
    const result = guardedFetch({ fetch: send, timeoutMs: 5000, logger: quiet, random: () => 0 })(
      'https://api.github.com/x',
    );
    await vi.advanceTimersByTimeAsync(999);
    expect(seen).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await result).status).toBe(200);
    expect(seen).toHaveLength(2);
  } finally {
    vi.useRealTimers();
  }
});
