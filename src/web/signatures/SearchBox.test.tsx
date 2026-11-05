// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { act, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { messages } from '../i18n/index.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { SEARCH_DEBOUNCE_MS, SearchBox } from './SearchBox.tsx';

// E18-S07: the search box asks 300 ms after the last key or at once on Enter, with one clean text; it follows the address when the
// address changes by itself and leaves the text alone when the address only caught up with it.

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** A box on an address of its own: it holds `q` the way the route does, and records each search it was asked to make. */
function Harness({ asked, start }: { readonly asked: (string | undefined)[]; readonly start?: string }) {
  const [q, setQ] = useState(start);
  return (
    <SearchBox
      q={q}
      onSearch={(next) => {
        asked.push(next);
        setQ(next);
      }}
    />
  );
}

const box = () => screen.getByRole<HTMLInputElement>('searchbox', { name: messages['signatures.search.field'] });
const type = (text: string) => {
  fireEvent.change(box(), { target: { value: text } });
};
const wait = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

test('the debounce is 300 ms', () => {
  expect(SEARCH_DEBOUNCE_MS).toBe(300);
});

test('nothing is asked before 300 ms after the last key, and one search is asked at 300 ms', () => {
  const asked: (string | undefined)[] = [];
  renderWithProviders(<Harness asked={asked} />);
  type('octocat');
  wait(SEARCH_DEBOUNCE_MS - 1);
  expect(asked).toEqual([]);
  wait(1);
  expect(asked).toEqual(['octocat']);
  wait(10_000);
  expect(asked).toEqual(['octocat']);
});

test('each key starts the 300 ms again, so a pause in typing asks for the whole text once', () => {
  const asked: (string | undefined)[] = [];
  renderWithProviders(<Harness asked={asked} />);
  type('oct');
  wait(200);
  type('octo');
  wait(200);
  expect(asked).toEqual([]);
  wait(100);
  expect(asked).toEqual(['octo']);
});

test('Enter asks at once and the debounce that was running asks nothing more', () => {
  const asked: (string | undefined)[] = [];
  renderWithProviders(<Harness asked={asked} />);
  type('octocat');
  wait(100);
  fireEvent.submit(box());
  expect(asked).toEqual(['octocat']);
  wait(10_000);
  expect(asked).toEqual(['octocat']);
});

test('Enter on a text that is the search already asks nothing', () => {
  const asked: (string | undefined)[] = [];
  renderWithProviders(<Harness asked={asked} start="octocat" />);
  fireEvent.submit(box());
  expect(asked).toEqual([]);
});

test('the text is sent trimmed, and a text of blanks is no search', () => {
  const asked: (string | undefined)[] = [];
  renderWithProviders(<Harness asked={asked} />);
  type('  octocat  ');
  wait(SEARCH_DEBOUNCE_MS);
  type('   ');
  wait(SEARCH_DEBOUNCE_MS);
  expect(asked).toEqual(['octocat', undefined]);
});

test('clearing the box asks for no search', () => {
  const asked: (string | undefined)[] = [];
  renderWithProviders(<Harness asked={asked} start="octocat" />);
  expect(box()).toHaveValue('octocat');
  type('');
  wait(SEARCH_DEBOUNCE_MS);
  expect(asked).toEqual([undefined]);
});

test('a space typed after the text is left in the box when the address catches up with the trimmed text', () => {
  const asked: (string | undefined)[] = [];
  renderWithProviders(<Harness asked={asked} />);
  type('octo ');
  wait(SEARCH_DEBOUNCE_MS);
  expect(asked).toEqual(['octo']);
  expect(box()).toHaveValue('octo ');
});

test('when the address changes by itself the box shows the new search, and an address with none empties it', () => {
  const asked: (string | undefined)[] = [];
  const view = renderWithProviders(<SearchBox q="octocat" onSearch={(next) => asked.push(next)} />);
  expect(box()).toHaveValue('octocat');
  view.rerender(<SearchBox q="hubot" onSearch={(next) => asked.push(next)} />);
  expect(box()).toHaveValue('hubot');
  view.rerender(<SearchBox q={undefined} onSearch={(next) => asked.push(next)} />);
  expect(box()).toHaveValue('');
  wait(10_000);
  expect(asked).toEqual([]);
});

test('the box is a search input that holds a login at most, and its help says what it finds', () => {
  const { container } = renderWithProviders(<Harness asked={[]} />);
  expect(container.querySelector('search')).toHaveAttribute('aria-label', messages['signatures.search.label']);
  expect(box()).toHaveAttribute('type', 'search');
  expect(box()).toHaveAttribute('maxlength', '100');
  expect(box()).toHaveAccessibleDescription(messages['signatures.search.help']);
});
