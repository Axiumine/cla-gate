// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { type Clock, eventually, timed } from './wait.ts';

// E19-S12: waiting and timing, on a clock the test moves by hand.

/** A clock that starts at zero, moves only when something sleeps, and remembers how long each sleep was. */
function manual(): Clock & { readonly sleeps: number[] } {
  let time = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => time,
    sleep: (ms) => {
      sleeps.push(ms);
      time += ms;
      return Promise.resolve();
    },
  };
}

test('eventually returns the first answer that is not undefined, trying again after half a second each time', async () => {
  const clock = manual();
  let calls = 0;
  const value = await eventually(clock, 'the answer', 10_000, () => {
    calls += 1;
    return Promise.resolve(calls < 3 ? undefined : { answer: calls });
  });
  expect(value).toEqual({ answer: 3 });
  expect(clock.sleeps).toEqual([500, 500]);
});

test('an answer that is falsy but defined counts: 0 and the empty string are answers', async () => {
  expect(await eventually(manual(), 'zero', 1000, () => Promise.resolve(0))).toBe(0);
  expect(await eventually(manual(), 'empty', 1000, () => Promise.resolve(''))).toBe('');
});

test('eventually gives up when the time is over, and says what it waited for and for how long', async () => {
  const clock = manual();
  await expect(eventually(clock, 'the database', 1500, () => Promise.resolve(undefined))).rejects.toThrow(
    new Error('the database did not happen within 1500 ms'),
  );
  expect(clock.sleeps).toEqual([500, 500, 500]);
});

test('a probe that throws has not succeeded yet, and the last reason is part of the error', async () => {
  const clock = manual();
  let calls = 0;
  const probe = () => {
    calls += 1;
    return Promise.reject(new Error(`connection refused ${calls}`));
  };
  await expect(eventually(clock, 'the proxy', 1000, probe)).rejects.toThrow(
    'the proxy did not happen within 1000 ms: connection refused 3',
  );
});

test('a probe that threw and then answered undefined leaves no stale reason', async () => {
  let calls = 0;
  const probe = () => {
    calls += 1;
    return calls === 1 ? Promise.reject(new Error('refused')) : Promise.resolve(undefined);
  };
  await expect(eventually(manual(), 'it', 1000, probe)).rejects.toThrow(new Error('it did not happen within 1000 ms'));
});

test('a probe that throws and then succeeds is a success', async () => {
  let calls = 0;
  const probe = () => {
    calls += 1;
    return calls === 1 ? Promise.reject(new Error('refused')) : Promise.resolve('up');
  };
  expect(await eventually(manual(), 'it', 1000, probe)).toBe('up');
});

test('timed reports the value and the milliseconds the clock moved while it ran', async () => {
  const clock = manual();
  const result = await timed(clock, async () => {
    await clock.sleep(250);
    return 'done';
  });
  expect(result).toEqual({ value: 'done', ms: 250 });
});
