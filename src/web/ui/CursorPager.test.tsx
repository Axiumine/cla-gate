// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { act, screen } from '@testing-library/react';
import { createRef } from 'react';
import { expect, test, vi } from 'vitest';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { type PagerControl, PagerPages } from '../test-support/pager.tsx';
import { renderWithProviders } from '../test-support/render.tsx';
import { CursorPager } from './CursorPager.tsx';

// E17-S10: CursorPager, over the opaque cursors of the server. PagerPages (src/web/test-support/pager.tsx) is a screen with
// three pages, c2 then c3 then no more, that goes into loading when the pager asks and waits for the test to end the load.

const button = (name: string) => screen.getByRole('button', { name });
const status = () => screen.getByRole('status');

/** Renders the three-page screen; `finish` and `fail` end the load the last press started, as the server answering would. */
function pages(onCursor?: (cursor: string | undefined) => void) {
  const control = createRef<PagerControl>();
  const view = renderWithProviders(<PagerPages ref={control} {...(onCursor ? { onCursor } : {})} />);
  return {
    ...view,
    finish: () => {
      act(() => control.current?.finish());
    },
    fail: () => {
      act(() => control.current?.fail());
    },
  };
}

test('it is a navigation named Pagination with Previous, the page and Next, and on the first page Previous is off', () => {
  pages();
  expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
  expect(button('Previous')).toBeDisabled();
  expect(button('Next')).toBeEnabled();
  expect(status()).toHaveTextContent('Page 1');
  expect(status()).toHaveAttribute('aria-live', 'polite');
});

test('on the last page Next is off', () => {
  renderWithProviders(<CursorPager cursor="c3" nextCursor={null} onCursorChange={vi.fn()} />);
  expect(button('Next')).toBeDisabled();
});

test('Next hands the screen the cursor the server gave, untouched, and Previous the cursor of the page before', async () => {
  const onCursor = vi.fn<(cursor: string | undefined) => void>();
  const { user, finish } = pages(onCursor);
  await user.click(button('Next'));
  finish();
  await user.click(button('Next'));
  finish();
  expect(onCursor.mock.calls).toEqual([['c2'], ['c3']]);
  await user.click(button('Previous'));
  finish();
  await user.click(button('Previous'));
  finish();
  expect(onCursor.mock.calls).toEqual([['c2'], ['c3'], ['c2'], [undefined]]);
  expect(button('Previous')).toBeDisabled();
});

test('an opaque cursor is passed through whatever it holds', async () => {
  const odd = 'eyJ0IjoiMjAyNiJ9+/=?&%00 <b>';
  const onCursorChange = vi.fn();
  const { user } = renderWithProviders(
    <CursorPager cursor={undefined} nextCursor={odd} onCursorChange={onCursorChange} />,
  );
  await user.click(button('Next'));
  expect(onCursorChange).toHaveBeenCalledExactlyOnceWith(odd);
});

test('the page change is announced once the page has loaded, and the old page stays announced while it loads', async () => {
  const { user, finish } = pages();
  const region = status();
  await user.click(button('Next'));
  expect(status()).toBe(region);
  expect(region).toHaveTextContent('Page 1');
  finish();
  expect(region).toHaveTextContent('Page 2');
  await user.click(button('Next'));
  expect(region).toHaveTextContent('Page 2');
  finish();
  expect(region).toHaveTextContent('Page 3');
  await user.click(button('Previous'));
  expect(region).toHaveTextContent('Page 3');
  finish();
  expect(region).toHaveTextContent('Page 2');
});

test('both buttons are disabled while a page loads', async () => {
  const { user, finish } = pages();
  await user.click(button('Next'));
  expect(button('Previous')).toBeDisabled();
  expect(button('Next')).toBeDisabled();
  finish();
  expect(button('Previous')).toBeEnabled();
  expect(button('Next')).toBeEnabled();
});

test('a page that could not be loaded is said in an alert, the announced page does not change, and the pager works from the page on screen', async () => {
  const onCursor = vi.fn<(cursor: string | undefined) => void>();
  const { user, fail, finish } = pages(onCursor);
  await user.click(button('Next'));
  finish();
  await user.click(button('Next'));
  fail();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'That page could not be loaded. The page you see has not changed.',
  );
  expect(status()).toHaveTextContent('Page 2');
  expect(button('Previous')).toBeEnabled();
  expect(button('Next')).toBeEnabled();
  await user.click(button('Previous'));
  finish();
  expect(onCursor).toHaveBeenLastCalledWith(undefined);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(status()).toHaveTextContent('Page 1');
});

test('after a failure Next asks for the same page again, and the message goes while it is asked for', async () => {
  const onCursor = vi.fn<(cursor: string | undefined) => void>();
  const { user, fail, finish } = pages(onCursor);
  await user.click(button('Next'));
  fail();
  expect(status()).toHaveTextContent('Page 1');
  expect(button('Previous')).toBeDisabled();
  await user.click(button('Next'));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  finish();
  expect(onCursor.mock.calls).toEqual([['c2'], ['c2']]);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(status()).toHaveTextContent('Page 2');
});

test('a screen that leaves the cursor where it was after a failure has no earlier page to go back to', async () => {
  const props = { nextCursor: 'c2', onCursorChange: vi.fn() };
  const { user, rerender } = renderWithProviders(<CursorPager cursor={undefined} {...props} />);
  await user.click(button('Next'));
  rerender(<CursorPager cursor={undefined} {...props} failed />);
  expect(button('Previous')).toBeDisabled();
  expect(button('Next')).toBeEnabled();
  expect(status()).toHaveTextContent('Page 1');
});

test('the browser going back drops the later pages from the way back', async () => {
  const onCursorChange = vi.fn();
  const { user, rerender } = renderWithProviders(
    <CursorPager cursor={undefined} nextCursor="c2" onCursorChange={onCursorChange} />,
  );
  await user.click(button('Next'));
  rerender(<CursorPager cursor="c2" nextCursor="c3" onCursorChange={onCursorChange} />);
  await user.click(button('Next'));
  rerender(<CursorPager cursor="c3" nextCursor={null} onCursorChange={onCursorChange} />);
  expect(status()).toHaveTextContent('Page 3');
  rerender(<CursorPager cursor="c2" nextCursor="c3" onCursorChange={onCursorChange} />);
  expect(status()).toHaveTextContent('Page 2');
  await user.click(button('Previous'));
  expect(onCursorChange).toHaveBeenLastCalledWith(undefined);
});

test('a reload on a later page cannot count it, has no way back until it has been forward, and then goes back to it', async () => {
  const onCursorChange = vi.fn();
  const { user, rerender } = renderWithProviders(
    <CursorPager cursor="c3" nextCursor="c4" onCursorChange={onCursorChange} />,
  );
  expect(status()).toHaveTextContent('A later page');
  expect(button('Previous')).toBeDisabled();
  await user.click(button('Next'));
  rerender(<CursorPager cursor="c4" nextCursor={null} onCursorChange={onCursorChange} />);
  expect(status()).toHaveTextContent('A later page');
  await user.click(button('Previous'));
  expect(onCursorChange).toHaveBeenLastCalledWith('c3');
});

test('the keyboard drives it: Tab reaches the enabled buttons, Enter and Space press them, Escape does nothing', async () => {
  const onCursor = vi.fn<(cursor: string | undefined) => void>();
  const { user, finish } = pages(onCursor);
  await user.tab();
  expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
  await user.tab();
  expect(button('Next')).toHaveFocus();
  await user.keyboard('{Enter}');
  finish();
  await user.keyboard(' ');
  finish();
  await user.keyboard('{Escape}');
  expect(onCursor.mock.calls).toEqual([['c2'], ['c3']]);
  expect(button('Next')).toBeDisabled();
  expect(button('Previous')).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(onCursor).toHaveBeenLastCalledWith('c2');
});

test('the pager passes axe on a middle page, while loading and after a failure', async () => {
  const { container, user, finish, fail } = pages();
  await expectNoA11yViolations(container);
  await user.click(button('Next'));
  await expectNoA11yViolations(container);
  fail();
  await expectNoA11yViolations(container);
  await user.click(button('Next'));
  finish();
  await expectNoA11yViolations(container);
});
