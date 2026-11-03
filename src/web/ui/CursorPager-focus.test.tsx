// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { act, screen } from '@testing-library/react';
import { createRef } from 'react';
import { expect, test } from 'vitest';
import { type PagerControl, PagerPages } from '../test-support/pager.tsx';
import { renderWithProviders } from '../test-support/render.tsx';

// E17-S10: while a page loads both buttons are disabled, and a browser then moves focus to the page. The pager puts it
// back, so a keyboard user can press Next again and again. jsdom does not move focus when a button is disabled, so the
// tests do it with blur(), which is what the browser does.

const button = (name: string) => screen.getByRole('button', { name });

/** What a browser does when the button that has focus is switched off: focus goes to the page. jsdom's blur() ignores a disabled button, so focus goes to a spare button first. */
function dropFocusOnPage() {
  button('Elsewhere').focus();
  button('Elsewhere').blur();
}

function pages() {
  const control = createRef<PagerControl>();
  const view = renderWithProviders(<PagerPages ref={control} />);
  return {
    ...view,
    start: () => {
      act(() => control.current?.start());
    },
    finish: () => {
      act(() => control.current?.finish());
    },
  };
}

test('focus the browser dropped on the page during the load goes back to the button that was pressed', async () => {
  const { user, finish } = pages();
  await user.click(button('Next'));
  dropFocusOnPage();
  expect(document.body).toHaveFocus();
  finish();
  expect(button('Next')).toHaveFocus();
});

test('on the last page the button that was pressed is off, so focus goes to Previous', async () => {
  const { user, finish } = pages();
  await user.click(button('Next'));
  finish();
  await user.click(button('Next'));
  dropFocusOnPage();
  finish();
  expect(button('Next')).toBeDisabled();
  expect(button('Previous')).toHaveFocus();
});

test('a browser that leaves focus on the disabled button still ends on a button that works', async () => {
  const { user, finish } = pages();
  await user.click(button('Next'));
  finish();
  await user.click(button('Next'));
  expect(button('Next')).toHaveFocus();
  finish();
  expect(button('Previous')).toHaveFocus();
});

test('Previous that was pressed gets focus back, and focus that never left is left alone', async () => {
  const { user, finish } = pages();
  await user.click(button('Next'));
  finish();
  await user.click(button('Previous'));
  dropFocusOnPage();
  finish();
  expect(button('Next')).toHaveFocus();
  await user.click(button('Next'));
  finish();
  expect(button('Next')).toHaveFocus();
});

test('focus that went somewhere else on purpose during the load is not taken back', async () => {
  const { user, finish } = pages();
  await user.click(button('Next'));
  button('Elsewhere').focus();
  finish();
  expect(button('Elsewhere')).toHaveFocus();
});

test('a load that no press started moves nothing', () => {
  const { start, finish } = pages();
  dropFocusOnPage();
  start();
  finish();
  expect(document.body).toHaveFocus();
});

test('a press is used up by its own load: a later load that nobody pressed for does not take focus', async () => {
  const { user, start, finish } = pages();
  await user.click(button('Next'));
  finish();
  expect(button('Next')).toHaveFocus();
  dropFocusOnPage();
  start();
  finish();
  expect(document.body).toHaveFocus();
});
