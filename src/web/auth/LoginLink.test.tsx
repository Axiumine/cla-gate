// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { LoginLink } from './LoginLink.tsx';

// E17-S08: the link that starts the login is a plain anchor, so the browser loads it as a page.

test('it is a link to the login start with the words it is given', () => {
  render(<LoginLink>Log in</LoginLink>);
  expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/api/auth/login');
});

test('the path it is given travels as return_to, checked', () => {
  render(
    <>
      <LoginLink returnTo="/sign/42?pr=7">fine</LoginLink>
      <LoginLink returnTo="//evil.example">hostile</LoginLink>
    </>,
  );
  expect(screen.getByRole('link', { name: 'fine' })).toHaveAttribute(
    'href',
    '/api/auth/login?return_to=%2Fsign%2F42%3Fpr%3D7',
  );
  expect(screen.getByRole('link', { name: 'hostile' })).toHaveAttribute('href', '/api/auth/login?return_to=%2F');
});

test('the button look is the primary button and the text look is an underlined link', () => {
  render(
    <>
      <LoginLink>as a button</LoginLink>
      <LoginLink look="text">as text</LoginLink>
    </>,
  );
  expect(screen.getByRole('link', { name: 'as a button' })).toHaveClass('bg-accent', 'text-on-accent');
  expect(screen.getByRole('link', { name: 'as text' })).toHaveClass('underline');
  expect(screen.getByRole('link', { name: 'as text' })).not.toHaveClass('bg-accent');
});

test('it is reached with Tab and followed with Enter, and it has no client-side handler: the browser does the navigation', async () => {
  const user = userEvent.setup();
  render(<LoginLink>Log in</LoginLink>);
  await user.tab();
  const link = screen.getByRole('link', { name: 'Log in' });
  expect(link).toHaveFocus();
  const seen: boolean[] = [];
  const record = (event: Event) => {
    seen.push(event.defaultPrevented);
    event.preventDefault();
  };
  document.addEventListener('click', record);
  await user.keyboard('{Enter}');
  document.removeEventListener('click', record);
  expect(seen).toEqual([false]);
});

test('it passes axe in both looks', async () => {
  const { container } = render(
    <>
      <LoginLink>as a button</LoginLink>
      <LoginLink look="text">as text</LoginLink>
    </>,
  );
  await expectNoA11yViolations(container);
});
