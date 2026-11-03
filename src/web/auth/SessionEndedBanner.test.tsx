// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { focusManager } from '@tanstack/react-query';
import { screen, within } from '@testing-library/react';
import { delay } from 'msw';
import { type ReactNode, useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { answer, envelope, listThings } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { TestAppRoutes } from '../test-support/app-routes.tsx';
import { renderWithProviders } from '../test-support/render.tsx';
import { ALICE } from '../test-support/session.ts';
import { useApiClient } from './hooks.ts';
import { SESSION_KEY } from './session.ts';

// E17-S08: when a call comes back 401 the session query is invalidated, the cache is cleared and a banner takes the place of
// the blank page; what the person was typing stays on screen.

/** A page with a field the person is typing into and a button whose call the server answers 401 to. */
function Notes(): ReactNode {
  const client = useApiClient();
  const [text, setText] = useState('');
  return (
    <form>
      <label>
        Notes
        <input
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
      </label>
      <button
        type="button"
        onClick={() => {
          client.call(listThings).catch(() => undefined);
        }}
      >
        Save notes
      </button>
    </form>
  );
}

const pages = [
  { path: '/notes', access: 'authenticated', component: Notes },
  { path: '/open', access: 'public', component: Notes },
] as const;

afterEach(() => {
  vi.useRealTimers();
  focusManager.setFocused();
});

/**
 * The page at `route` for a logged-in person, once it is on screen. The server then ends the session: from now on every call,
 * the session endpoint included, is a 401, which is what an expired session looks like. The next call to the list is the 401.
 */
async function sessionThatEnds(route = '/notes') {
  answer(listThings.path, envelope(401, 'unauthorized'));
  const rendered = renderWithProviders(<TestAppRoutes route={route} pages={pages} />, { session: ALICE });
  const field = await screen.findByLabelText('Notes');
  await screen.findByRole('button', { name: messages['auth.logout'] });
  rendered.setSession(undefined);
  return { ...rendered, field };
}

const save = () => screen.getByRole('button', { name: 'Save notes' });

/** The banner's live region: the shell puts it just above the header, and it is not the shell's own region for page titles. */
function bannerRegion(): HTMLElement {
  const region = screen.getByRole('banner').previousElementSibling;
  if (!(region instanceof HTMLElement) || region.getAttribute('role') !== 'status') {
    throw new Error('the banner region is not just above the header');
  }
  return region;
}

test('the banner region is in the page before anything happens, empty, so that a screen reader announces what comes into it', async () => {
  renderWithProviders(<TestAppRoutes route="/notes" pages={pages} />, { session: ALICE });
  await screen.findByLabelText('Notes');
  expect(bannerRegion()).toBeEmptyDOMElement();
});

test('a 401 after the person typed puts up the banner with a login link that returns to the page, and the typed text stays', async () => {
  const { user, queryClient, field } = await sessionThatEnds('/notes?draft=1');
  queryClient.setQueryData(['repositories', 42], ['one', 'two']);
  await user.type(field, 'half a sentence');
  await user.click(save());

  const banner = await screen.findByText(messages['auth.sessionEnded']);
  const region = bannerRegion();
  expect(region).toContainElement(banner);
  expect(within(region).getByRole('link', { name: messages['auth.login'] })).toHaveAttribute(
    'href',
    '/api/auth/login?return_to=%2Fnotes%3Fdraft%3D1',
  );
  expect(screen.getByLabelText('Notes')).toBe(field);
  expect(field).toHaveValue('half a sentence');
  expect(queryClient.getQueryData(['repositories', 42])).toBeUndefined();
});

test('the banner does not block: the page below it is still there and the field still takes input', async () => {
  const { user, field } = await sessionThatEnds();
  await user.click(save());
  await screen.findByText(messages['auth.sessionEnded']);
  await user.type(field, 'more');
  expect(field).toHaveValue('more');
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('the user menu follows: it offers the login instead of "Log out"', async () => {
  const { user } = await sessionThatEnds();
  await user.click(save());
  await screen.findByText(messages['auth.sessionEnded']);
  expect(screen.queryByRole('button', { name: messages['auth.logout'] })).toBeNull();
  expect(screen.getAllByRole('link', { name: messages['auth.login'] })).toHaveLength(2);
});

test('the session is invalidated: the server is asked again, and it confirms that nobody is logged in', async () => {
  const { user, sessionRequests, queryClient } = await sessionThatEnds();
  const before = sessionRequests.length;
  await user.click(save());
  await screen.findByText(messages['auth.sessionEnded']);
  await vi.waitFor(() => {
    expect(sessionRequests.length).toBeGreaterThan(before);
  });
  expect(queryClient.getQueryData(SESSION_KEY)).toEqual({ authenticated: false });
  expect(screen.getByText(messages['auth.sessionEnded'])).toBeInTheDocument();
});

test('a login made in another tab removes the banner once the window gets focus after the session was last checked', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const { user, setSession } = await sessionThatEnds();
  await user.click(save());
  await screen.findByText(messages['auth.sessionEnded']);
  vi.setSystemTime(Date.now() + 61_000);
  setSession(ALICE);
  focusManager.setFocused(true);
  await screen.findByRole('button', { name: messages['auth.logout'] });
  expect(screen.queryByText(messages['auth.sessionEnded'])).toBeNull();
});

test('a 401 for a visitor who was never logged in says nothing about a session', async () => {
  answer(listThings.path, envelope(401, 'unauthorized'));
  const { user } = renderWithProviders(<TestAppRoutes route="/open" pages={pages} />);
  await screen.findByLabelText('Notes');
  await screen.findByRole('link', { name: messages['auth.login'] });
  await user.click(save());
  await delay(30);
  expect(bannerRegion()).toBeEmptyDOMElement();
});

test('the login link of the banner is a plain link that Tab reaches', async () => {
  const { user } = await sessionThatEnds();
  await user.click(save());
  await screen.findByText(messages['auth.sessionEnded']);
  const link = within(bannerRegion()).getByRole('link', { name: messages['auth.login'] });
  expect(link.tagName).toBe('A');
  // The "Skip to content" link is the first stop of the page (E17-S09); the banner is the next one.
  screen.getByRole('link', { name: messages['nav.skip'] }).focus();
  await user.tab();
  expect(link).toHaveFocus();
});

test('the page with the banner passes axe', async () => {
  const { user, container } = await sessionThatEnds();
  await user.click(save());
  await screen.findByText(messages['auth.sessionEnded']);
  await expectNoA11yViolations(container);
});
