// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQuery } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, test } from 'vitest';
import { sessionRoute } from '../../shared/auth-contract.ts';
import { errorResponseSchema } from '../../shared/errors.ts';
import { DEFAULT_SOURCE_URL, metaRoute } from '../../shared/meta.ts';
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

test('the session endpoint the helper answers is the path of the shared route descriptor', async () => {
  renderWithProviders(<p>page</p>, { session: SESSION });
  const reply = await fetch(sessionRoute.path);
  expect(await reply.json()).toEqual(SESSION);
});

test('the render gives the UI the query client it returns, with the defaults of the app except that nothing retries', () => {
  const { queryClient } = renderWithProviders(<p>page</p>);
  expect(queryClient.getDefaultOptions().queries).toMatchObject({ retry: false, staleTime: 30_000, gcTime: 300_000 });
  expect(queryClient.getDefaultOptions().mutations).toEqual({ retry: false });
});

function Seeded() {
  const { data } = useQuery({ queryKey: ['seeded'], queryFn: () => 'from the server' });
  return <p>{data ?? 'loading'}</p>;
}

test('a query of the rendered UI runs in that client, so a test can seed or read its cache', async () => {
  const { queryClient } = renderWithProviders(<Seeded />);
  expect(await screen.findByText('from the server')).toBeInTheDocument();
  expect(queryClient.getQueryData(['seeded'])).toBe('from the server');
});

test('every render has a cache of its own', () => {
  const first = renderWithProviders(<p>page</p>);
  const second = renderWithProviders(<p>page</p>);
  expect(second.queryClient).not.toBe(first.queryClient);
});

test('the render records each request the session endpoint receives, and setSession changes the answer from then on', async () => {
  const { sessionRequests, setSession } = renderWithProviders(<p>page</p>, { session: SESSION });
  expect(sessionRequests).toHaveLength(0);
  expect((await fetch(sessionRoute.path, { headers: { 'x-probe': 'one' } })).status).toBe(200);
  setSession(undefined);
  expect((await fetch(sessionRoute.path)).status).toBe(401);
  setSession({ ...SESSION, user: { ...SESSION.user, login: 'monalisa' } });
  const reply = await fetch(sessionRoute.path);
  expect(await reply.json()).toMatchObject({ user: { login: 'monalisa' } });
  expect(sessionRequests).toHaveLength(3);
  expect(sessionRequests[0]?.headers.get('x-probe')).toBe('one');
});

test('a session that setSession is given is checked against the shared contract too', () => {
  const { setSession } = renderWithProviders(<p>page</p>);
  expect(() => {
    setSession({ ...SESSION, csrfToken: 'short' });
  }).toThrow();
});

test('the meta endpoint answers with the default repository and no commit unless an option says otherwise (E17-S09)', async () => {
  renderWithProviders(<p>page</p>);
  expect(await (await fetch(metaRoute.path)).json()).toEqual({
    sourceUrl: DEFAULT_SOURCE_URL,
    commit: null,
    installUrl: null,
  });
  const meta = { sourceUrl: 'https://git.example.test/org/cla', commit: 'c'.repeat(40), installUrl: null };
  renderWithProviders(<p>page</p>, { meta });
  expect(await (await fetch(metaRoute.path)).json()).toEqual(meta);
});
