// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { IDS, payloadOf, sorted, without, withValue } from './test-support.ts';

// The helpers of the routing tests (E06-S04) are tested like code: a helper that quietly changed nothing would let a
// hostile-payload row pass without being hostile.

/** The value at the dotted `path` of `value`, or `undefined` where the path leaves the object. */
function read(value: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (node, key) => (typeof node === 'object' && node !== null ? Reflect.get(node, key) : undefined),
      value,
    );
}

test('payloadOf gives a fresh copy each time, so a test that changes one cannot change the next', () => {
  const first = payloadOf('pull_request');
  Reflect.set(first, 'action', 'changed');
  expect(payloadOf('pull_request')['action']).toBe('opened');
});

test('withValue sets the value at a dotted path on a copy and leaves the original alone', () => {
  const original = payloadOf('check_run');
  const changed = withValue(original, 'check_run.app.id', 99);
  expect(read(changed, 'check_run.app.id')).toBe(99);
  expect(read(original, 'check_run.app.id')).toBe(IDS.app);
});

test('a path of one key changes the top level of the payload', () => {
  expect(withValue(payloadOf('pull_request'), 'action', 'closed')['action']).toBe('closed');
  expect(without(payloadOf('pull_request'), 'action')).not.toHaveProperty('action');
});

test('without removes the key at a dotted path on a copy', () => {
  const original = payloadOf('issue_comment');
  const changed = without(original, 'issue.pull_request');
  expect(read(changed, 'issue.pull_request')).toBeUndefined();
  expect(read(original, 'issue.pull_request')).toBeDefined();
});

test.each(['missing.id', 'action.id', 'action.id.deeper', 'repository.owner.id.deeper'])(
  'a path that does not lead to an object (%s) throws',
  (path) => {
    expect(() => withValue(payloadOf('pull_request'), path, 1)).toThrow(`the fixture has no object at ${path}`);
    expect(() => without(payloadOf('pull_request'), path)).toThrow(`the fixture has no object at ${path}`);
  },
);

test('sorted orders by locale and does not change its argument', () => {
  const names = ['b', 'a', 'C'];
  expect(sorted(names)).toEqual(['a', 'b', 'C']);
  expect(names).toEqual(['b', 'a', 'C']);
});
