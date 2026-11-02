// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../shared/errors.ts';
import { renderWithProviders } from './render.tsx';

const SESSION = {
  user: { githubId: 4711, login: 'octocat', name: null, avatarUrl: null },
  expiresAt: '2026-11-02T10:00:00.000Z',
  csrfToken: 'A'.repeat(43),
};

/** A button that counts its presses, to prove that what the helper returns drives a real React component. */
function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button
      type="button"
      onClick={() => {
        setCount(count + 1);
      }}
    >
      {`pressed ${count}`}
    </button>
  );
}

test('renderWithProviders renders the element into the document', () => {
  renderWithProviders(<p>hello</p>);
  expect(screen.getByText('hello')).toBeInTheDocument();
});

test('the user it returns presses the rendered button with the mouse, Enter and Space', async () => {
  const { user } = renderWithProviders(<Counter />);
  await user.click(screen.getByRole('button', { name: 'pressed 0' }));
  await user.keyboard('{Enter}');
  await user.keyboard(' ');
  expect(screen.getByRole('button', { name: 'pressed 3' })).toHaveFocus();
});

test.each([
  ['no route', undefined, '/'],
  ['a path', '/sign/42', '/sign/42'],
  ['a path with a query', '/login/failed?reason=access_denied', '/login/failed?reason=access_denied'],
])('with %s the app starts on %s', (_what, route, expected) => {
  renderWithProviders(<p>page</p>, route === undefined ? {} : { route });
  expect(window.location.pathname + window.location.search).toBe(expected);
});

test('a session option is what the session endpoint answers, as the shared contract spells it', async () => {
  renderWithProviders(<p>page</p>, { session: SESSION });
  const reply = await fetch('/api/auth/session');
  expect(reply.status).toBe(200);
  expect(await reply.json()).toEqual(SESSION);
});

test('without a session option the visitor is anonymous: 401 with the standard error body', async () => {
  renderWithProviders(<p>page</p>);
  const reply = await fetch('/api/auth/session');
  expect(reply.status).toBe(401);
  expect(errorResponseSchema.parse(await reply.json()).error.code).toBe('unauthorized');
});

test('a session the server could never send fails the test that uses it', () => {
  expect(() => renderWithProviders(<p>page</p>, { session: { ...SESSION, csrfToken: 'short' } })).toThrow();
  expect(screen.queryByText('page')).not.toBeInTheDocument();
});
