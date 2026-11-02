// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { render } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { HOSTILE_NAMES } from '../../shared/hostile-names.ts';
import { activeContent, expectHostileNamesInert, type HostileView } from './hostile.ts';

// E17-S06: the hostile-name helper passes a component that shows a name as text, and fails, naming the name, for each
// way a name can become something else. The failing views are built with the DOM API: nothing here is itself an injection.

/** A view whose container holds `build`'s elements and the name as text, unless `text` says to show something else. */
function viewOf(build: (container: HTMLElement) => void, text: (name: string) => string = (name) => name) {
  return (name: string): HostileView => {
    const container = document.createElement('div');
    container.append(text(name));
    build(container);
    return { container, unmount: vi.fn() };
  };
}

/** Adds an empty element of the given tag. */
const element = (tag: string) => (container: HTMLElement) => {
  container.append(document.createElement(tag));
};

/** A link with `href`, or with no href attribute at all when `href` is null. */
const anchor = (href: string | null) => (container: HTMLElement) => {
  const link = document.createElement('a');
  if (href !== null) {
    link.setAttribute('href', href);
  }
  container.append(link);
};

test('a component that shows every name as text passes, and each render is taken out again', () => {
  const unmounts: (() => void)[] = [];
  expectHostileNamesInert((name) => {
    const view = render(<p>{name}</p>);
    const unmount = vi.fn(view.unmount);
    unmounts.push(unmount);
    return { container: view.container, unmount };
  });
  expect(unmounts).toHaveLength(HOSTILE_NAMES.length);
  for (const unmount of unmounts) {
    expect(unmount).toHaveBeenCalledTimes(1);
  }
});

test('the helper visits every name of the shared corpus', () => {
  const seen: string[] = [];
  expectHostileNamesInert((name) => {
    seen.push(name);
    return viewOf(() => undefined)(name);
  });
  expect(seen).toEqual([...HOSTILE_NAMES]);
});

test.each([
  ['a script element', viewOf(element('script'))],
  ['an img element', viewOf(element('img'))],
  ['a javascript: link', viewOf(anchor('javascript:alert(1)'))],
  ['a javascript: link in capitals', viewOf(anchor('JavaScript:alert(1)'))],
  ['a javascript: link behind a space', viewOf(anchor(' javascript:alert(1)'))],
])('a render that adds %s fails, and the failure names the name that did it', (_what, render) => {
  expect(() => {
    expectHostileNamesInert(render);
  }).toThrow(/rendering/u);
});

test('a render that shows something other than the name fails: the name must be there as typed', () => {
  expect(() => {
    expectHostileNamesInert(
      viewOf(
        () => undefined,
        () => 'a name that is not the one given',
      ),
    );
  }).toThrow(/the text of/u);
});

test.each([
  ['nothing to report', viewOf(() => undefined)('x').container, []],
  ['a script', viewOf(element('script'))('x').container, ['a script element']],
  ['an image', viewOf(element('img'))('x').container, ['an img element']],
  ['an ordinary link', viewOf(anchor('https://example.com/'))('x').container, []],
  ['a link with an empty href', viewOf(anchor(''))('x').container, []],
  ['a link with no href', viewOf(anchor(null))('x').container, []],
  ['a script link', viewOf(anchor('javascript:void(0)'))('x').container, ['a link to javascript:void(0)']],
])('activeContent reports %s', (_what, container, expected) => {
  expect(activeContent(container)).toEqual(expected);
});
