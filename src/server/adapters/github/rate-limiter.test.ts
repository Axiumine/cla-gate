// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { systemClock } from '../../services/ports/clock.ts';
import { GitHubRateLimitedError, GitHubUnavailableError } from '../../services/ports/github-errors.ts';
import { captureLogs } from '../../test-support.ts';
import { createLogger } from '../http/logger.ts';
import { gate, lane, limited, limiterFixture, scripted, settle } from './limiter-fixture/test-support.ts';
import { RateLimiter } from './rate-limiter.ts';

const READ = 'GET /repositories/{repository_id}';
const WRITE = 'POST /repos/{owner}/{repo}/check-runs';
const A = lane(11);
const B = lane(12);

/** The error a promise rejected with. @throws Error when it resolved or rejected with something else. */
async function rejection(promise: Promise<unknown>): Promise<GitHubRateLimitedError> {
  const error = await promise.then(
    () => undefined,
    (failure: unknown) => failure,
  );
  if (error instanceof GitHubRateLimitedError) {
    return error;
  }
  throw new Error('expected a GitHubRateLimitedError');
}

// A limit that GitHub answers with.

test('a limit of 2 s is slept through and the request repeated: two attempts, one wait of 2 s', async () => {
  const { limiter, waits } = limiterFixture();
  const request = scripted(limited(2), 'answer');
  expect(await limiter.run(A, READ, request.attempt)).toBe('answer');
  expect([request.count(), waits]).toEqual([2, [2000]]);
});

test('a limit of 60 s is slept through; a limit of 61 s is raised at once without a wait', async () => {
  const slept = limiterFixture();
  const sixty = scripted(limited(60), 'answer');
  expect(await slept.limiter.run(A, READ, sixty.attempt)).toBe('answer');
  expect([sixty.count(), slept.waits]).toEqual([2, [60_000]]);

  const raised = limiterFixture();
  const sixtyOne = scripted(limited(61), 'answer');
  const error = await rejection(raised.limiter.run(A, READ, sixtyOne.attempt));
  expect([error.retryAfterSeconds, sixtyOne.count(), raised.waits]).toEqual([61, 1, []]);
});

test('a limit of 120 s is raised at once with its seconds and scope, and nothing sleeps', async () => {
  const { limiter, waits } = limiterFixture();
  const request = scripted(limited(120, 'primary'), 'answer');
  const error = await rejection(limiter.run(A, READ, request.attempt));
  expect(error).toMatchObject({ retryAfterSeconds: 120, scope: 'primary' });
  expect([request.count(), waits]).toEqual([1, []]);
});

test('the third limit in a row is raised: two waits, three attempts, and the last limit is the one raised', async () => {
  const { limiter, waits } = limiterFixture();
  const request = scripted(limited(2), limited(3), limited(4, 'primary'), 'answer');
  const error = await rejection(limiter.run(A, READ, request.attempt));
  expect(error).toMatchObject({ retryAfterSeconds: 4, scope: 'primary' });
  expect([request.count(), waits]).toEqual([3, [2000, 3000]]);
});

test('a failure that is not a limit goes on unchanged after one attempt and is not logged', async () => {
  const { limiter, waits, logs } = limiterFixture();
  const outage = new GitHubUnavailableError('down');
  const request = scripted(outage, 'answer');
  await expect(limiter.run(A, READ, request.attempt)).rejects.toBe(outage);
  expect([request.count(), waits, logs.text()]).toEqual([1, [], '']);
});

test('each wait is one WARN with the scope, the seconds, the route template and the numeric installation id', async () => {
  const { limiter, logs } = limiterFixture();
  await limiter.run(A, READ, scripted(limited(2, 'primary'), limited(3), 'answer').attempt);
  const lines = logs.lines().filter((entry) => entry['msg'] === 'github.rate_limited');
  expect(
    lines.map((entry) => [
      entry['level'],
      entry['scope'],
      entry['waitSeconds'],
      entry['route'],
      entry['installationId'],
    ]),
  ).toEqual([
    [40, 'primary', 2, READ, 11],
    [40, 'secondary', 3, READ, 11],
  ]);
});

test('a request raised for a long limit logs nothing: it did not wait', async () => {
  const { limiter, logs } = limiterFixture();
  await rejection(limiter.run(A, READ, scripted(limited(600)).attempt));
  expect(logs.text()).toBe('');
});

test('the App has its own lane, logged with no installation id', async () => {
  const { limiter, logs } = limiterFixture();
  await limiter.run('app', 'GET /app/installations', scripted(limited(5), 'answer').attempt);
  const [entry] = logs.lines();
  expect([entry?.['route'], entry?.['installationId'], entry?.['scope']]).toEqual([
    'GET /app/installations',
    null,
    'secondary',
  ]);
});

// The state a limit leaves in its lane.

test('after a long limit the lane refuses at once, without asking GitHub, until the limit has run out', async () => {
  const { limiter, clock, waits } = limiterFixture();
  await rejection(limiter.run(A, READ, scripted(limited(120, 'primary')).attempt));
  clock.advance(500);
  const request = scripted('answer');
  const error = await rejection(limiter.run(A, READ, request.attempt));
  expect(error).toMatchObject({ retryAfterSeconds: 120, scope: 'primary' });
  expect([request.count(), waits]).toEqual([0, []]);
  clock.advance(60_000);
  expect(await limiter.run(A, READ, request.attempt)).toBe('answer');
  expect(waits).toEqual([59_500]);
});

test('a refusal by the lane does not extend the limit: asking again and again never keeps it shut', async () => {
  const { limiter, clock, waits } = limiterFixture();
  await rejection(limiter.run(A, READ, scripted(limited(120)).attempt));
  clock.advance(500);
  await rejection(limiter.run(A, READ, scripted('answer').attempt));
  await rejection(limiter.run(A, READ, scripted('answer').attempt));
  clock.advance(119_500);
  expect(await limiter.run(A, READ, scripted('answer').attempt)).toBe('answer');
  expect(waits).toEqual([]);
});

test('a shorter limit that comes in later does not shorten a longer one that is running', async () => {
  const { limiter, waits } = limiterFixture();
  const first = gate();
  const second = gate();
  const long = limiter.run(A, READ, async () => {
    await first.promise;
    throw limited(120);
  });
  const short = limiter.run(A, READ, async () => {
    await second.promise;
    throw limited(2);
  });
  await settle();
  first.open();
  await rejection(long);
  second.open();
  expect(await rejection(short)).toMatchObject({ retryAfterSeconds: 120 });
  expect(waits).toEqual([]);
});

test('a request of a limited lane that arrives during the wait sleeps the rest of it too', async () => {
  const release = gate();
  const { limiter, waits, logs } = limiterFixture(() => release.promise);
  const first = limiter.run(A, READ, scripted(limited(10), 'first').attempt);
  await settle();
  const second = limiter.run(A, READ, scripted('second').attempt);
  await settle();
  expect(waits).toEqual([10_000, 10_000]);
  const warnings = logs.lines().filter((entry) => entry['msg'] === 'github.rate_limited');
  expect(
    warnings.map((entry) => [entry['scope'], entry['waitSeconds'], entry['route'], entry['installationId']]),
  ).toEqual([
    ['secondary', 10, READ, 11],
    ['secondary', 10, READ, 11],
  ]);
  release.open();
  expect(await Promise.all([first, second])).toEqual(['first', 'second']);
});

test('a limit on one installation delays no other installation', async () => {
  const release = gate();
  const { limiter, waits } = limiterFixture((milliseconds) =>
    milliseconds === 30_000 ? release.promise : Promise.resolve(),
  );
  let finished = false;
  const limitedOne = limiter.run(A, READ, scripted(limited(30), 'a').attempt).then((value) => {
    finished = true;
    return value;
  });
  await settle();
  const other = scripted('b');
  expect(await limiter.run(B, READ, other.attempt)).toBe('b');
  expect([finished, other.count(), waits]).toEqual([false, 1, [30_000]]);
  release.open();
  expect(await limitedOne).toBe('a');
});

test('the App and an installation are separate lanes', async () => {
  const { limiter, waits } = limiterFixture();
  await rejection(limiter.run(A, READ, scripted(limited(120)).attempt));
  expect(await limiter.run('app', 'GET /app', scripted('app').attempt)).toBe('app');
  expect(waits).toEqual([]);
});

// How many requests run at once.

/** Runs `count` requests per lane and returns the most that were in flight in any lane and over all lanes. */
async function peaks(lanes: number, count: number): Promise<{ lane: number; overall: number }> {
  const { limiter } = limiterFixture();
  const going = new Map<number, number>();
  let overall = 0;
  let peakOverall = 0;
  let peakLane = 0;
  const request = (n: number) => async () => {
    const inLane = (going.get(n) ?? 0) + 1;
    going.set(n, inLane);
    overall += 1;
    peakLane = Math.max(peakLane, inLane);
    peakOverall = Math.max(peakOverall, overall);
    await settle();
    going.set(n, inLane - 1);
    overall -= 1;
  };
  const runs = Array.from({ length: lanes * count }, (_unused, i) =>
    limiter.run(lane(1 + (i % lanes)), READ, request(1 + (i % lanes))),
  );
  await Promise.all(runs);
  return { lane: peakLane, overall: peakOverall };
}

test('at most 10 requests of one installation are in flight, whatever is asked', async () => {
  expect(await peaks(1, 100)).toEqual({ lane: 10, overall: 10 });
});

test('at most 50 requests are in flight over all installations, each of them held to 10', async () => {
  expect(await peaks(5, 20)).toEqual({ lane: 10, overall: 50 });
  const spread = await peaks(12, 10);
  expect(spread.overall).toBe(50);
  expect(spread.lane).toBeLessThanOrEqual(10);
});

test('a request that fails gives its place back, so a lane of failures does not shut', async () => {
  const { limiter } = limiterFixture();
  const failures = Array.from({ length: 30 }, () => limiter.run(A, READ, () => Promise.reject(new Error('boom'))));
  await Promise.allSettled(failures);
  expect(await limiter.run(A, READ, scripted('answer').attempt)).toBe('answer');
});

// Writes.

/** The time, relative to the start, at which each request began. */
function starts(clock: { now(): Date }, begun: number[], first: number) {
  return () => {
    begun.push(clock.now().getTime() - first);
    return Promise.resolve('ok');
  };
}

test('writes to one installation start at least 1 s apart, a read is not held up', async () => {
  const { limiter, clock, waits } = limiterFixture();
  const first = clock.now().getTime();
  const begun: number[] = [];
  await Promise.all([
    limiter.run(A, WRITE, starts(clock, begun, first)),
    limiter.run(A, WRITE, starts(clock, begun, first)),
    limiter.run(A, 'PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}', starts(clock, begun, first)),
    limiter.run(A, READ, starts(clock, begun, first)),
  ]);
  expect(begun.toSorted((a, b) => a - b)).toEqual([0, 0, 1000, 2000]);
  expect(waits).toEqual([1000, 1000]);
});

test.each([['POST'], ['PATCH'], ['PUT'], ['DELETE']])('a %s is a write: the one after it waits 1 s', async (method) => {
  const { limiter, waits } = limiterFixture();
  await limiter.run(A, `${method} /x`, scripted().attempt);
  await limiter.run(A, `${method} /x`, scripted().attempt);
  expect(waits).toEqual([1000]);
});

test('a GET and a HEAD are reads: nothing waits between them', async () => {
  const { limiter, waits } = limiterFixture();
  await limiter.run(A, 'GET /x', scripted().attempt);
  await limiter.run(A, 'HEAD /x', scripted().attempt);
  await limiter.run(A, 'GET /x', scripted().attempt);
  expect(waits).toEqual([]);
});

test('the spacing is counted from the start of a write: a slow write leaves nothing to wait for', async () => {
  const { limiter, clock, waits } = limiterFixture();
  await limiter.run(A, WRITE, () => {
    clock.advance(3000);
    return Promise.resolve('slow');
  });
  await limiter.run(A, WRITE, scripted().attempt);
  expect(waits).toEqual([]);
});

test('writes of one installation never overlap', async () => {
  const { limiter } = limiterFixture();
  let going = 0;
  let peak = 0;
  const write = async () => {
    going += 1;
    peak = Math.max(peak, going);
    await settle();
    going -= 1;
  };
  await Promise.all([limiter.run(A, WRITE, write), limiter.run(A, WRITE, write), limiter.run(A, WRITE, write)]);
  expect(peak).toBe(1);
});

test('writes to two installations are not spaced against each other', async () => {
  const { limiter, waits } = limiterFixture();
  await Promise.all([limiter.run(A, WRITE, scripted().attempt), limiter.run(B, WRITE, scripted().attempt)]);
  expect(waits).toEqual([]);
});

test('a write that meets a short limit is repeated after the wait, and the writes behind it still keep the spacing', async () => {
  const { limiter, waits } = limiterFixture();
  const order: string[] = [];
  const first = scripted(limited(2), 'first');
  const second = scripted('second');
  const named = (name: string, request: { attempt: () => Promise<string> }) => () => {
    order.push(name);
    return request.attempt();
  };
  await Promise.all([limiter.run(A, WRITE, named('first', first)), limiter.run(A, WRITE, named('second', second))]);
  expect(order).toEqual(['first', 'second', 'first']);
  expect(waits).toEqual([2000, 1000]);
});

// The bucket of points.

test('900 reads in a minute go at once; the 901st waits for its point to come back', async () => {
  const { limiter, waits } = limiterFixture();
  for (let n = 0; n < 900; n += 1) {
    await limiter.run(A, READ, scripted().attempt);
  }
  expect(waits).toEqual([]);
  await limiter.run(A, READ, scripted().attempt);
  expect(waits).toEqual([67]);
});

test('a write costs 5 points: after 898 reads it waits for the 3 points the bucket lacks', async () => {
  const { limiter, waits } = limiterFixture();
  for (let n = 0; n < 898; n += 1) {
    await limiter.run(A, READ, scripted().attempt);
  }
  await limiter.run(A, WRITE, scripted().attempt);
  expect(waits).toEqual([200]);
});

test('the bucket of one installation does not slow another', async () => {
  const { limiter, waits } = limiterFixture();
  for (let n = 0; n < 900; n += 1) {
    await limiter.run(A, READ, scripted().attempt);
  }
  await limiter.run(B, READ, scripted().attempt);
  expect(waits).toEqual([]);
});

// What the limiter remembers.

test('a lane that is as good as new is forgotten when the limiter is full of lanes; one that is not, is kept', async () => {
  const { limiter, clock } = limiterFixture();
  await rejection(limiter.run(lane(5000), READ, scripted(limited(600)).attempt));
  for (let n = 1; n < 1000; n += 1) {
    await limiter.run(lane(n), READ, scripted().attempt);
  }
  expect(limiter.lanes).toBe(1000);
  clock.advance(60_000);
  await limiter.run(lane(9999), READ, scripted().attempt);
  expect(limiter.lanes).toBe(2);
  await rejection(limiter.run(lane(5000), READ, scripted('answer').attempt));
});

test('lanes that are busy are kept when the limiter is full: it grows past the limit rather than drop them', async () => {
  const { limiter } = limiterFixture();
  const hold = gate();
  const busy = Array.from({ length: 1000 }, (_unused, n) => limiter.run(lane(n + 1), READ, () => hold.promise));
  const late = limiter.run(lane(2000), READ, scripted('late').attempt);
  expect(limiter.lanes).toBe(1001);
  hold.open();
  await Promise.all(busy);
  expect(await late).toBe('late');
});

// Time as it is, without the fixture.

test('without an injected wait, a limit is a real timer of the seconds GitHub asked for', async () => {
  vi.useFakeTimers();
  try {
    const limiter = new RateLimiter({
      clock: systemClock,
      logger: createLogger({ logLevel: 'silent' }, captureLogs().destination),
    });
    const request = scripted(limited(2), 'answer');
    const result = limiter.run(A, READ, request.attempt);
    await vi.advanceTimersByTimeAsync(1999);
    expect(request.count()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe('answer');
    expect(request.count()).toBe(2);
  } finally {
    vi.useRealTimers();
  }
});
