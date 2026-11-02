// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { HOSTILE_NAMES } from '../../shared/hostile-names.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { activeContent } from '../test-support/hostile.ts';
import { Avatar } from './Avatar.tsx';

// E17-S08: the picture of the logged-in person, or their initials.

const URL_OF_AVATAR = 'https://avatars.githubusercontent.com/u/4711?v=4';

test('with an avatar it is a decorative picture from that address that sends no referrer', () => {
  const { container } = render(<Avatar login="octocat" avatarUrl={URL_OF_AVATAR} />);
  const image = container.querySelector('img');
  expect(image).toHaveAttribute('src', URL_OF_AVATAR);
  expect(image).toHaveAttribute('alt', '');
  expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
  expect(image).toHaveAttribute('width', '32');
  expect(image).toHaveAttribute('height', '32');
});

test('without an avatar it shows the first two characters of the login in upper case, hidden from assistive technology', () => {
  const { container } = render(<Avatar login="octocat" avatarUrl={null} />);
  expect(container.querySelector('img')).toBeNull();
  const initials = container.querySelector('span');
  expect(initials).toHaveTextContent('OC');
  expect(initials).toHaveAttribute('aria-hidden', 'true');
});

test.each([
  ['a single character', 'x', 'X'],
  ['an empty login', '', ''],
  ['a login with a dash', 'a-b-c', 'A-'],
  ['characters outside the basic plane, which are not cut in half', '😀😀😀', '😀😀'],
])('the initials of %s', (_what, login, expected) => {
  const { container } = render(<Avatar login={login} avatarUrl={null} />);
  expect(container.querySelector('span')?.textContent).toBe(expected);
});

test('a hostile login is only ever text: no script, picture or script link appears', () => {
  for (const name of HOSTILE_NAMES) {
    const { container, unmount } = render(<Avatar login={name} avatarUrl={null} />);
    expect(activeContent(container)).toEqual([]);
    unmount();
  }
});

test('both forms pass axe', async () => {
  const withPicture = render(<Avatar login="octocat" avatarUrl={URL_OF_AVATAR} />);
  await expectNoA11yViolations(withPicture.container);
  const initials = render(<Avatar login="octocat" avatarUrl={null} />);
  await expectNoA11yViolations(initials.container);
});
