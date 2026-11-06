// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { fireEvent, renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { useDismiss } from './use-dismiss.ts';

// E18-S04: an open disclosure is dismissed by Escape and by focus or a pointer going outside it, and by nothing else; the listeners are
// on the document and are gone when it closes or the component does. The pointer is tested on its own: a click in a browser also moves
// focus, so a test that clicks cannot tell the two listeners apart.

/** A container with a button in it, and an element outside it, both in the document. */
function page() {
  const container = document.createElement('div');
  const inside = document.createElement('button');
  container.append(inside);
  const outside = document.createElement('p');
  document.body.append(container, outside);
  return { container, inside, outside, ref: { current: container } };
}

/** The hook on a page, with `onDismiss` recording what it was told. */
function setup(open = true) {
  const dom = page();
  const onDismiss = vi.fn<(how: 'escape' | 'outside') => void>();
  const view = renderHook(
    ({ isOpen }) => {
      useDismiss(dom.ref, isOpen, onDismiss);
    },
    { initialProps: { isOpen: open } },
  );
  return { ...dom, onDismiss, view };
}

test('a pointer going down outside the container dismisses it as "outside"', () => {
  const { outside, onDismiss } = setup();
  fireEvent.pointerDown(outside);
  expect(onDismiss.mock.calls).toEqual([['outside']]);
});

test('a pointer going down inside the container does not dismiss it', () => {
  const { inside, container, onDismiss } = setup();
  fireEvent.pointerDown(inside);
  fireEvent.pointerDown(container);
  expect(onDismiss).not.toHaveBeenCalled();
});

test('focus going outside dismisses it as "outside", and focus inside does not', () => {
  const { inside, outside, onDismiss } = setup();
  fireEvent.focusIn(inside);
  expect(onDismiss).not.toHaveBeenCalled();
  fireEvent.focusIn(outside);
  expect(onDismiss.mock.calls).toEqual([['outside']]);
});

test('Escape dismisses it as "escape", and no other key does', () => {
  const { onDismiss } = setup();
  fireEvent.keyDown(document.body, { key: 'Enter' });
  fireEvent.keyDown(document.body, { key: 'Tab' });
  expect(onDismiss).not.toHaveBeenCalled();
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(onDismiss.mock.calls).toEqual([['escape']]);
});

test('while it is closed nothing dismisses it', () => {
  const { outside, onDismiss } = setup(false);
  fireEvent.pointerDown(outside);
  fireEvent.focusIn(outside);
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(onDismiss).not.toHaveBeenCalled();
});

test('closing it takes the listeners away, and opening it again puts them back', () => {
  const { outside, onDismiss, view } = setup();
  view.rerender({ isOpen: false });
  fireEvent.pointerDown(outside);
  fireEvent.focusIn(outside);
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(onDismiss).not.toHaveBeenCalled();
  view.rerender({ isOpen: true });
  fireEvent.pointerDown(outside);
  expect(onDismiss.mock.calls).toEqual([['outside']]);
});

test('the component going away takes the three listeners away', () => {
  const { outside, onDismiss, view } = setup();
  view.unmount();
  fireEvent.pointerDown(outside);
  fireEvent.focusIn(outside);
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(onDismiss).not.toHaveBeenCalled();
});

test('a container that is not in the page yet dismisses nothing by a pointer or by focus', () => {
  const { outside } = page();
  const onDismiss = vi.fn();
  renderHook(() => {
    useDismiss({ current: null }, true, onDismiss);
  });
  fireEvent.pointerDown(outside);
  fireEvent.focusIn(outside);
  expect(onDismiss).not.toHaveBeenCalled();
});
