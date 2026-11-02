// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { GitHubForbiddenError, GitHubRateLimitedError } from '../../services/ports/github-errors.ts';
import {
  clientFixture,
  installationJson,
  json,
  line,
  type RouteAnswer,
  repositoryJson,
} from './client-fixture/test-support.ts';
import { gate } from './limiter-fixture/test-support.ts';
import { START } from './test-support.ts';

// The rate limits of E05-S05 as the Octokit adapter meets them: MSW answers the way GitHub does, the waits are recorded
// and move the fixture's clock (which starts at START).

const id = parseGithubId;

const SECONDARY_TEXT = 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.';
const PRIMARY_TEXT = 'API rate limit exceeded for installation ID 11.';

/** Answers `status` with `headers` and `message` for the first `times` requests, then with one installation. */
function limits(status: number, headers: Record<string, string>, message = SECONDARY_TEXT, times = 1): RouteAnswer {
  let left = times;
  return () => {
    if (left > 0) {
      left -= 1;
      return json({ message, documentation_url: 'https://docs.github.com/x' }, status, headers);
    }
    return json([installationJson(11)]);
  };
}

/** The headers of a used-up primary budget that resets `seconds` after the start of the test. */
const used = (seconds: number): Record<string, string> => ({
  'x-ratelimit-remaining': '0',
  'x-ratelimit-reset': String(Date.parse(START) / 1000 + seconds),
});

// Waiting out a limit.

test('a 429 with retry-after: 2 waits 2 s and repeats the request: two requests in all', async () => {
  const { client, calls, waits } = clientFixture({ 'GET /app/installations': limits(429, { 'retry-after': '2' }) });
  expect(await client.listInstallations()).toHaveLength(1);
  expect([calls.length, waits]).toEqual([2, [2000]]);
});

test('a 403 with retry-after is waited out like a 429', async () => {
  const { client, calls, waits } = clientFixture({ 'GET /app/installations': limits(403, { 'retry-after': '30' }) });
  await client.listInstallations();
  expect([calls.length, waits]).toEqual([2, [30_000]]);
});

test('retry-after: 120 rejects at once with the seconds and the scope, and nothing sleeps', async () => {
  const { client, calls, waits } = clientFixture({ 'GET /app/installations': limits(429, { 'retry-after': '120' }) });
  const failure = await client.listInstallations().catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(GitHubRateLimitedError);
  expect(failure).toMatchObject({ retryAfterSeconds: 120, scope: 'secondary' });
  expect([calls.length, waits]).toEqual([1, []]);
});

test('x-ratelimit-remaining: 0 with a reset in 10 s waits until the reset, then repeats', async () => {
  const { client, calls, waits, clock } = clientFixture({
    'GET /app/installations': limits(403, used(10), PRIMARY_TEXT),
  });
  await client.listInstallations();
  expect([calls.length, waits]).toEqual([2, [10_000]]);
  expect(clock.now().toISOString()).toBe('2026-11-02T10:00:10.000Z');
});

test('x-ratelimit-remaining: 0 with a reset in 600 s rejects at once with scope primary, and nothing sleeps', async () => {
  const { client, calls, waits } = clientFixture({ 'GET /app/installations': limits(429, used(600), PRIMARY_TEXT) });
  const failure = await client.listInstallations().catch((error: unknown) => error);
  expect(failure).toMatchObject({ retryAfterSeconds: 600, scope: 'primary' });
  expect([calls.length, waits]).toEqual([1, []]);
});

test('a secondary-limit 403 without retry-after is a wait of 60 s', async () => {
  const { client, calls, waits } = clientFixture({ 'GET /app/installations': limits(403, {}) });
  await client.listInstallations();
  expect([calls.length, waits]).toEqual([2, [60_000]]);
});

test('three 429s in a row end in GitHubRateLimitedError after two waits and three requests', async () => {
  const { client, calls, waits } = clientFixture({
    'GET /app/installations': limits(429, { 'retry-after': '2' }, SECONDARY_TEXT, 3),
  });
  const failure = await client.listInstallations().catch((error: unknown) => error);
  expect(failure).toMatchObject({ name: 'GitHubRateLimitedError', retryAfterSeconds: 2, scope: 'secondary' });
  expect([calls.length, waits]).toEqual([3, [2000, 2000]]);
});

test('a 403 that is a permission error is GitHubForbiddenError and is not repeated', async () => {
  const { client, calls, waits } = clientFixture({
    'GET /app/installations': () =>
      json({ message: 'Resource not accessible by integration' }, 403, { 'x-ratelimit-remaining': '4990' }),
  });
  await expect(client.listInstallations()).rejects.toBeInstanceOf(GitHubForbiddenError);
  expect([calls.length, waits]).toEqual([1, []]);
});

test('a limit on the second page repeats the second page only, and the list is whole', async () => {
  let secondPages = 0;
  const { client, calls, waits } = clientFixture({
    'GET /installation/repositories': (call) => {
      if (!call.search.includes('page=2')) {
        return json({ repositories: [repositoryJson(1)] }, 200, {
          link: '<https://api.github.com/installation/repositories?per_page=100&page=2>; rel="next"',
        });
      }
      secondPages += 1;
      return secondPages === 1
        ? json({ message: SECONDARY_TEXT }, 429, { 'retry-after': '3' })
        : json({ repositories: [repositoryJson(2)] });
    },
  });
  expect((await client.listInstallationRepositories(id(11))).map((repository) => repository.id)).toEqual([1, 2]);
  expect(calls.map(line)).toEqual([
    'GET /installation/repositories?per_page=100',
    'GET /installation/repositories?per_page=100&page=2',
    'GET /installation/repositories?per_page=100&page=2',
  ]);
  expect(waits).toEqual([3000]);
});

test('a repository call that meets a 403 limit is repeated with the same token, not read as a removal', async () => {
  let asked = 0;
  const { client, calls, invalidated } = clientFixture({
    'GET /repositories/:id': () => {
      asked += 1;
      return asked === 1 ? json({ message: SECONDARY_TEXT }, 403, {}) : json(repositoryJson(101));
    },
  });
  expect(await client.getRepositoryById(id(11), id(101))).toMatchObject({ id: 101 });
  expect(calls.map((call) => call.headers.get('authorization'))).toEqual([
    'Bearer ghs_made-up-11-1',
    'Bearer ghs_made-up-11-1',
  ]);
  expect(invalidated).toEqual([]);
});

// What is logged.

test('each wait is one WARN with the scope, the seconds, the route template and the installation id, and no more', async () => {
  const { client, logs } = clientFixture({
    'GET /repositories/:id': limits(429, { 'retry-after': '2', 'x-secret-header': 'ghs_leak' }),
  });
  await client.getRepositoryById(id(11), id(101)).catch(() => undefined);
  const entries = logs.lines().filter((entry) => entry['msg'] === 'github.rate_limited');
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    level: 40,
    scope: 'secondary',
    waitSeconds: 2,
    route: 'GET /repositories/{repository_id}',
    installationId: 11,
  });
  expect(logs.text()).not.toMatch(/ghs_|Bearer|per_page|api\.github\.com|secondary rate limit|docs\.github\.com/);
});

test('the App signs its own requests in its own lane, logged with no installation id', async () => {
  const { client, logs } = clientFixture({ 'GET /app/installations': limits(429, { 'retry-after': '2' }) });
  await client.listInstallations();
  const [entry] = logs.lines().filter((candidate) => candidate['msg'] === 'github.rate_limited');
  expect(entry).toMatchObject({ route: 'GET /app/installations', installationId: null });
});

// Per installation.

test('while one installation waits out a limit, another installation is not delayed', async () => {
  const release = gate();
  const finished: string[] = [];
  const { client, waits } = clientFixture(
    {
      'GET /repositories/:id': (call) =>
        call.headers.get('authorization') === 'Bearer ghs_made-up-11-1' && finished.length === 0
          ? json({ message: SECONDARY_TEXT }, 429, { 'retry-after': '30' })
          : json(repositoryJson(101)),
    },
    { sleep: (milliseconds) => (milliseconds === 30_000 ? release.promise : Promise.resolve()) },
  );
  const limitedOne = client.getRepositoryById(id(11), id(101)).then(() => finished.push('11'));
  await vi.waitFor(() => {
    expect(waits).toEqual([30_000]);
  });
  await client.getRepositoryById(id(12), id(101));
  finished.push('12');
  expect(finished).toEqual(['12']);
  release.open();
  await limitedOne;
  expect(finished).toEqual(['12', '11']);
});

test('a limit on the installation does not delay the App, and the other way round', async () => {
  const release = gate();
  const { client, waits } = clientFixture(
    {
      'GET /repositories/:id': () => json({ message: SECONDARY_TEXT }, 429, { 'retry-after': '30' }),
      'GET /app/installations': () => json([installationJson(11)]),
    },
    { sleep: (milliseconds) => (milliseconds === 30_000 ? release.promise : Promise.resolve()) },
  );
  const limitedOne = client.getRepositoryById(id(11), id(101)).catch(() => undefined);
  await vi.waitFor(() => {
    expect(waits).toEqual([30_000]);
  });
  expect(await client.listInstallations()).toHaveLength(1);
  release.open();
  await limitedOne;
});

// How many requests are in flight.

/** Fires `perInstallation` GETs for each of `installations` installations and returns the peaks seen in the handler. */
async function fire(installations: number, perInstallation: number): Promise<{ lane: number; overall: number }> {
  const going = new Map<string, number>();
  let overall = 0;
  const peaks = { lane: 0, overall: 0 };
  const { client } = clientFixture({
    'GET /repositories/:id': async (call) => {
      const who = call.headers.get('authorization') ?? '';
      const inLane = (going.get(who) ?? 0) + 1;
      going.set(who, inLane);
      overall += 1;
      peaks.lane = Math.max(peaks.lane, inLane);
      peaks.overall = Math.max(peaks.overall, overall);
      await new Promise((resolve) => setTimeout(resolve, 40));
      going.set(who, (going.get(who) ?? 1) - 1);
      overall -= 1;
      return json(repositoryJson(101));
    },
  });
  const calls = Array.from({ length: installations * perInstallation }, (_unused, n) =>
    client.getRepositoryById(id(1 + (n % installations)), id(101)),
  );
  await Promise.all(calls);
  return peaks;
}

test('100 GETs for one installation: the handler never sees more than 10 at once', async () => {
  expect(await fire(1, 100)).toEqual({ lane: 10, overall: 10 });
});

test('GETs for many installations: the handler never sees more than 50 at once, nor 10 for one installation', async () => {
  const peaks = await fire(12, 10);
  expect(peaks.overall).toBe(50);
  expect(peaks.lane).toBeLessThanOrEqual(10);
});
