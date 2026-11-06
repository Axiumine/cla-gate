// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { type DefaultWatch, watchDefault } from './default-prevented.ts';

// The watch that tells a handler that stopped the browser's own action from one that did not.

/** The watch of the first test, kept to see that it stops with the test. */
let earlier: DefaultWatch | undefined;

/** An event of `type` that can be cancelled, sent to the document by `handler` first (as a component would), then recorded by the watch. */
function send(type: string, prevent: boolean): void {
  const target = document.createElement('button');
  document.body.append(target);
  target.addEventListener(type, (event) => {
    if (prevent) {
      event.preventDefault();
    }
  });
  target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
  target.remove();
}

test('the watch says, for each event that reached the document, whether its default action had been prevented', () => {
  const watch = watchDefault('click');
  send('click', true);
  send('click', false);
  send('click', true);
  expect(watch.prevented).toEqual([true, false, true]);
  earlier = watch;
});

test('the watch of an earlier test has ended: it sees nothing of this one', () => {
  expect(earlier?.prevented).toEqual([true, false, true]);
  send('click', true);
  expect(earlier?.prevented).toEqual([true, false, true]);
});

test('only the type asked for is recorded', () => {
  const watch = watchDefault('submit');
  send('click', true);
  send('submit', false);
  expect(watch.prevented).toEqual([false]);
});
