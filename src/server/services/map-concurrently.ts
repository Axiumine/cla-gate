// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * `fn` applied to every item, `concurrency` at a time, the answers in the order of the items. The items are taken in groups:
 * a group is started together and the next one only when all of it has settled, so the work in flight never exceeds
 * `concurrency` and a failure stops the later groups from starting. The first failure of a group is the one thrown.
 * @throws RangeError when `concurrency` is not a positive integer, and whatever `fn` throws.
 */
export async function mapConcurrently<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new RangeError('concurrency is a positive integer');
  }
  const answers: R[] = [];
  for (let start = 0; start < items.length; start += concurrency) {
    const group = items.slice(start, start + concurrency);
    answers.push(...(await Promise.all(group.map((item) => fn(item)))));
  }
  return answers;
}
