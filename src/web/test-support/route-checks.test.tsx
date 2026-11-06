// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement as h, type ReactElement } from 'react';
import { assert, expect, test } from 'vitest';
import { describeElement, h1Count, interactiveElements, positiveTabindexes, unreachableByTab } from './route-checks.ts';

// E18-S09: the checks of the route coverage guard are tested on pages made for the purpose, because a check that never fires proves
// nothing: each one must find the page that breaks its rule, and leave alone the page that keeps it.

// A page that breaks a rule on purpose is made with `h` (React's createElement) and not with JSX: the linters that guard the app's own
// markup (Biome's a11y rules) read JSX, and a positive tabindex or a tab that cannot be focused is what these tests need to exist.

/** Renders `page` and returns what the checks are given, and a user-event instance for it. */
function pageOf(page: ReactElement) {
  const { container } = render(page);
  return { container, user: userEvent.setup() };
}

test('an element is described by its tag, its role when it has one, and the start of its name', () => {
  const { container } = pageOf(
    <div>
      <a href="/x" aria-label="Go to the report">
        ignored
      </a>
      {h('div', { role: 'tab' }, 'The tab')}
      <button type="button">{'a'.repeat(60)}</button>
    </div>,
  );
  expect([...container.querySelectorAll('a, [role=tab], button')].map(describeElement)).toEqual([
    'a "Go to the report"',
    'div[role=tab] "The tab"',
    `button "${'a'.repeat(40)}"`,
  ]);
});

test('an element with no text and no label is described by its tag alone', () => {
  const { container } = pageOf(<input aria-hidden="false" />);
  const input = container.querySelector('input');
  assert.isNotNull(input);
  expect(describeElement(input)).toBe('input ""');
});

test('a positive tabindex is found, and 0 and -1 are not', () => {
  const { container } = pageOf(
    <div>
      <a href="/a">Open the late link</a>
      <button type="button" tabIndex={0}>
        natural
      </button>
      <h2 tabIndex={-1}>programmatic</h2>
      <div>first</div>
    </div>,
  );
  // Set on the page that was rendered: the linters that guard the app's markup refuse a positive tabindex in the source.
  container.querySelector('a')?.setAttribute('tabindex', '3');
  container.querySelector(':scope > div > div')?.setAttribute('tabindex', '1');
  expect(positiveTabindexes(container)).toEqual(['a "Open the late link"', 'div "first"']);
});

test('a page with no tabindex has no positive one', () => {
  const { container } = pageOf(<p>text</p>);
  expect(positiveTabindexes(container)).toEqual([]);
});

test.each([
  ['no h1', <p key="a">text</p>, 0],
  ['one h1', <h1 key="a">title</h1>, 1],
  ['two h1', [<h1 key="a">a</h1>, <h1 key="b">b</h1>], 2],
])('%s is counted as %d', (_what, page, count) => {
  const { container } = pageOf(<div>{page}</div>);
  expect(h1Count(container)).toBe(count);
});

test('the interactive elements are the ones a person can operate: disabled, hidden, inert and not-interactive ones are left out', () => {
  const { container } = pageOf(
    <div>
      <a href="/a">Open the report</a>
      {h('a', null, 'an anchor with no address')}
      <button type="button">button</button>
      <button type="button" disabled>
        disabled
      </button>
      <input type="hidden" />
      <input aria-label="text" />
      <div hidden>
        <button type="button">in a hidden block</button>
      </div>
      <div aria-hidden="true">
        <button type="button">aria-hidden</button>
      </div>
      {h('div', { inert: true }, <button type="button">inert</button>)}
      {h('div', { role: 'tab' }, 'tab')}
      <p>text</p>
      <h2 tabIndex={-1}>heading</h2>
    </div>,
  );
  expect(interactiveElements(container).map(describeElement)).toEqual([
    'a "Open the report"',
    'button "button"',
    'input "text"',
    'div[role=tab] "tab"',
  ]);
});

test('a page whose controls are all in the tab order has none that Tab misses', async () => {
  const { container, user } = pageOf(
    <div>
      <a href="/a">Open the report</a>
      <button type="button">button</button>
      <select aria-label="choice">
        <option>one</option>
      </select>
    </div>,
  );
  expect(await unreachableByTab(user, container)).toEqual([]);
});

test('a control taken out of the tab order is the one Tab misses', async () => {
  const { container, user } = pageOf(
    <div>
      <button type="button">reachable</button>
      <a href="/a" tabIndex={-1}>
        Open the unreachable report
      </a>
      <button type="button" disabled>
        disabled, so not a control
      </button>
    </div>,
  );
  expect(await unreachableByTab(user, container)).toEqual(['a "Open the unreachable report"']);
});

test('the walk starts at the top of the page even when something in the middle has focus', async () => {
  const { container, user } = pageOf(
    <div>
      <button type="button">first</button>
      <button type="button">second</button>
    </div>,
  );
  container.querySelectorAll('button')[1]?.focus();
  expect(await unreachableByTab(user, container)).toEqual([]);
});

test('the members of a radio group the arrow keys move among are reached when the group is', async () => {
  const { container, user } = pageOf(
    h(
      'div',
      { role: 'radiogroup', 'aria-label': 'theme', tabIndex: 0 },
      h('button', { type: 'button', role: 'radio', 'aria-checked': 'true', tabIndex: -1 }, 'light'),
      h('button', { type: 'button', role: 'radio', 'aria-checked': 'false', tabIndex: -1 }, 'dark'),
    ),
  );
  expect(await unreachableByTab(user, container)).toEqual([]);
});

test('the tabs of a tab list are reached through the one that is in the tab order', async () => {
  const { container, user } = pageOf(
    h(
      'div',
      { role: 'tablist', 'aria-label': 'views' },
      h('button', { type: 'button', role: 'tab', 'aria-selected': 'true', tabIndex: 0 }, 'one'),
      h('button', { type: 'button', role: 'tab', 'aria-selected': 'false', tabIndex: -1 }, 'two'),
    ),
  );
  expect(await unreachableByTab(user, container)).toEqual([]);
});

test('a group nothing in which takes Tab is missed, member by member', async () => {
  const { container, user } = pageOf(
    h(
      'div',
      { role: 'tablist', 'aria-label': 'views' },
      h('button', { type: 'button', role: 'tab', 'aria-selected': 'false', tabIndex: -1 }, 'one'),
      h('button', { type: 'button', role: 'tab', 'aria-selected': 'false', tabIndex: -1 }, 'two'),
    ),
  );
  expect(await unreachableByTab(user, container)).toEqual(['button[role=tab] "one"', 'button[role=tab] "two"']);
});

test('native radio buttons of one name are one tab stop: the checked one is reached and so is the group', async () => {
  const { container, user } = pageOf(
    <form>
      <input type="radio" name="size" aria-label="small" />
      <input type="radio" name="size" aria-label="large" defaultChecked />
    </form>,
  );
  expect(await unreachableByTab(user, container)).toEqual([]);
});

test('radio buttons of different names, or with no name, are not one group', async () => {
  const { container, user } = pageOf(
    <form>
      <input type="radio" name="a" aria-label="a" tabIndex={-1} />
      <input type="radio" name="b" aria-label="b" />
      <input type="radio" aria-label="unnamed" tabIndex={-1} />
      <input type="radio" aria-label="also unnamed" />
    </form>,
  );
  expect(await unreachableByTab(user, container)).toEqual(['input "a"', 'input "unnamed"']);
});

test('a radio button is not in the group of a text field of the same name', async () => {
  const { container, user } = pageOf(
    <form>
      <input name="x" aria-label="text" />
      <input type="radio" name="x" aria-label="radio" tabIndex={-1} />
    </form>,
  );
  expect(await unreachableByTab(user, container)).toEqual(['input "radio"']);
});

test('radio buttons of one name in two forms are two groups', async () => {
  const { container, user } = pageOf(
    <div>
      <form>
        <input type="radio" name="size" aria-label="one" />
      </form>
      <form>
        <input type="radio" name="size" aria-label="two" tabIndex={-1} />
      </form>
    </div>,
  );
  expect(await unreachableByTab(user, container)).toEqual(['input "two"']);
});

test('a page with nothing to tab to has nothing unreachable', async () => {
  const { container, user } = pageOf(<p>text</p>);
  expect(await unreachableByTab(user, container)).toEqual([]);
});
