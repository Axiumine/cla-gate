// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { render } from '@testing-library/react';
import { Dialog as RadixDialog } from 'radix-ui';
import { afterEach, expect, test, vi } from 'vitest';
import appCss from '../styles/app.css?raw';
import { atRulesOf, declarationsOf, parseCss } from '../test-support/css.ts';
import { lockScroll, SCROLL_GAP_PROPERTY, SCROLL_LOCK_CLASS, ScrollLock, useReturnFocus } from './overlay.tsx';

// E17-S10: what the overlays share. Radix's own overlay locks scrolling with a <style> element, which the
// Content-Security-Policy refuses, so the page is locked with a class that the stylesheet defines.

const root = document.documentElement;

afterEach(() => {
  vi.restoreAllMocks();
});

/** Makes the window 1000 px wide with a scrollbar of `scrollbar` px, which is what `innerWidth` less `clientWidth` measures. */
function scrollbarOf(scrollbar: number) {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1000);
  vi.spyOn(root, 'clientWidth', 'get').mockReturnValue(1000 - scrollbar);
}

test('locking sets the class and the width of the scrollbar it takes away, and letting go removes both', () => {
  scrollbarOf(15);
  const unlock = lockScroll();
  expect(root).toHaveClass(SCROLL_LOCK_CLASS);
  expect(root.style.getPropertyValue(SCROLL_GAP_PROPERTY)).toBe('15px');
  unlock();
  expect(root).not.toHaveClass(SCROLL_LOCK_CLASS);
  expect(root.style.getPropertyValue(SCROLL_GAP_PROPERTY)).toBe('');
});

test('a page whose scrollbar takes no room (an overlay scrollbar) has a gap of 0, never a negative one', () => {
  scrollbarOf(-4);
  const unlock = lockScroll();
  expect(root.style.getPropertyValue(SCROLL_GAP_PROPERTY)).toBe('0px');
  unlock();
});

test('with two overlays open the page unlocks when the last one lets go, not the first', () => {
  const first = lockScroll();
  const second = lockScroll();
  first();
  expect(root).toHaveClass(SCROLL_LOCK_CLASS);
  second();
  expect(root).not.toHaveClass(SCROLL_LOCK_CLASS);
});

test('ScrollLock locks while it is mounted and unlocks when it goes', () => {
  const { unmount } = render(<ScrollLock />);
  expect(root).toHaveClass(SCROLL_LOCK_CLASS);
  unmount();
  expect(root).not.toHaveClass(SCROLL_LOCK_CLASS);
});

test('the stylesheet defines the class: no scrolling, and the room of the scrollbar kept as padding', () => {
  const [base] = atRulesOf(parseCss(appCss), 'layer', 'base');
  const lock = declarationsOf(parseCss(base?.toString() ?? ''), `html.${SCROLL_LOCK_CLASS}`);
  expect(Object.fromEntries(lock)).toEqual({
    overflow: 'hidden',
    'padding-right': `var(${SCROLL_GAP_PROPERTY}, 0)`,
  });
});

function Probe({ onResult }: { readonly onResult: (focus: ReturnType<typeof useReturnFocus>) => void }) {
  onResult(useReturnFocus());
  return null;
}

test('the return focus remembers the focused element, puts focus back on it, and cancels the default focus', () => {
  const button = document.createElement('button');
  document.body.append(button);
  button.focus();
  let focus: ReturnType<typeof useReturnFocus> | undefined;
  render(
    <Probe
      onResult={(value) => {
        focus ??= value;
      }}
    />,
  );
  focus?.remember();
  button.blur();
  const event = new Event('focus', { cancelable: true });
  focus?.restore(event);
  expect(event.defaultPrevented).toBe(true);
  expect(button).toHaveFocus();
  button.remove();
});

test('with nothing to return to (focus was on the page, or nothing was remembered) restoring only cancels the default', () => {
  document.body.focus();
  let focus: ReturnType<typeof useReturnFocus> | undefined;
  render(
    <Probe
      onResult={(value) => {
        focus ??= value;
      }}
    />,
  );
  const early = new Event('focus', { cancelable: true });
  focus?.restore(early);
  focus?.remember();
  const event = new Event('focus', { cancelable: true });
  focus?.restore(event);
  expect(early.defaultPrevented).toBe(true);
  expect(event.defaultPrevented).toBe(true);
  expect(document.body).toHaveFocus();
});

test('focus on something that is not an HTML element (an SVG element) is not remembered, so restoring moves nothing', () => {
  const graphic = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  graphic.setAttribute('tabindex', '0');
  document.body.append(graphic);
  graphic.focus();
  expect(document.activeElement).toBe(graphic);
  let focus: ReturnType<typeof useReturnFocus> | undefined;
  render(
    <Probe
      onResult={(value) => {
        focus ??= value;
      }}
    />,
  );
  focus?.remember();
  graphic.blur();
  focus?.restore(new Event('focus', { cancelable: true }));
  expect(document.body).toHaveFocus();
  graphic.remove();
});

test('the control: the overlay of Radix does put a <style> element in the page, which is why the primitives draw their own', () => {
  const before = document.querySelectorAll('style').length;
  const { unmount } = render(
    <RadixDialog.Root open>
      <RadixDialog.Portal>
        <RadixDialog.Overlay />
        <RadixDialog.Content aria-describedby={undefined}>
          <RadixDialog.Title>Control</RadixDialog.Title>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>,
  );
  expect(document.querySelectorAll('style').length).toBeGreaterThan(before);
  unmount();
});
