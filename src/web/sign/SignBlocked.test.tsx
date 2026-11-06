// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import { signContextRoute } from '../../shared/sign-context.ts';
import { answer, json } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  blockedContext,
  contextOf,
  contextResponse,
  failure,
  openSignPage,
  pageMain,
  serveHeldContext,
  serveSign,
} from './test-support.ts';

// E18-S02: a person with no verified email address. The form is replaced by instructions and a link to the email settings on
// GitHub, with "Check again", which asks for the context again. There is no field to type an address.

/** The button that asks again. */
const checkAgain = () => screen.getByRole('button', { name: messages['sign.blocked.check'] });

/** The heading of the form that appears once the person can sign. */
const formHeading = () => screen.findByRole('heading', { level: 2, name: messages['sign.form.title'] });

/** The blocked page, then (for the second request) whatever `next` is: the contexts the server answers with, in turn. */
async function openBlocked(...next: Response[]) {
  serveSign({ context: blockedContext() });
  const contexts = answer(signContextRoute.path, blockedContext(), ...next);
  const opened = await openSignPage();
  return { ...opened, contexts };
}

test('the form is replaced by instructions, the link to the email settings of GitHub, and "Check again"', async () => {
  await openBlocked();
  const panel = within(pageMain()).getByRole('status');
  expect(within(panel).getByText(messages['sign.blocked.message'])).toBeInTheDocument();
  expect(within(panel).getByText(messages['sign.blocked.steps'])).toBeInTheDocument();
  const settings = within(panel).getByRole('link', { name: messages['sign.blocked.settings'] });
  expect(settings).toHaveAttribute('href', 'https://github.com/settings/emails');
  expect(settings).toHaveAttribute('rel', 'noopener noreferrer');
  expect(settings).toHaveAttribute('target', '_blank');
  expect(within(panel).getByRole('button', { name: messages['sign.blocked.check'] })).toBeInTheDocument();
});

test('there is no field to type an address, and no form at all', async () => {
  const { container } = await openBlocked();
  expect(container.querySelector('form')).toBeNull();
  expect(container.querySelector('input[type="email"]')).toBeNull();
  expect(within(pageMain()).queryByRole('textbox')).toBeNull();
  expect(within(pageMain()).queryByRole('radiogroup')).toBeNull();
  expect(within(pageMain()).queryByRole('checkbox')).toBeNull();
});

test('"Log in again" starts the login that returns to this page, where GitHub reports the new address', async () => {
  await openBlocked();
  const link = within(pageMain()).getByRole('link', { name: messages['sign.blocked.relogin'] });
  const href = new URL(link.getAttribute('href') ?? '', 'http://localhost');
  expect(href.pathname).toBe('/api/auth/login');
  expect(href.searchParams.get('return_to')).toBe('/sign/123?pr=45');
});

test('without a pull request "Log in again" returns to the page without one', async () => {
  serveSign({ context: blockedContext({ pr: null, prUrl: null }) });
  await openSignPage('/sign/123');
  const link = within(pageMain()).getByRole('link', { name: messages['sign.blocked.relogin'] });
  expect(new URL(link.getAttribute('href') ?? '', 'http://localhost').searchParams.get('return_to')).toBe('/sign/123');
});

test('"Check again" asks for the context again, and the form takes the place of the instructions with focus on its heading', async () => {
  const { user, contexts } = await openBlocked(contextResponse());
  await user.click(checkAgain());
  const heading = await formHeading();
  expect(contexts).toHaveLength(2);
  await waitFor(() => {
    expect(heading).toHaveFocus();
  });
  expect(screen.queryByText(messages['sign.blocked.title'])).toBeNull();
  expect(
    screen.getByRole('textbox', { name: (name) => name.startsWith(messages['sign.name.label']) }),
  ).toBeInTheDocument();
});

test('"Check again" while nothing has changed is busy while it asks, says so after, and keeps focus on the button', async () => {
  const { user } = await openBlocked();
  const { release } = serveHeldContext();
  await user.click(checkAgain());
  await waitFor(() => {
    expect(checkAgain()).toHaveAttribute('aria-busy', 'true');
  });
  release(blockedContext());
  expect(await screen.findByText(messages['sign.blocked.still'])).toBeInTheDocument();
  expect(checkAgain()).not.toHaveAttribute('aria-busy');
  expect(checkAgain()).toHaveFocus();
  expect(screen.getByRole('heading', { level: 2, name: messages['sign.blocked.title'] })).toBeInTheDocument();
});

test('"Check again" that fails keeps the instructions, shows the failure above them, and says nothing about a change', async () => {
  const { user } = await openBlocked(failure(500, 'internal_server_error'));
  await user.click(checkAgain());
  expect(await screen.findByText(messages['errors.internal_server_error'])).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: messages['sign.blocked.title'] })).toBeInTheDocument();
  expect(screen.queryByText(messages['sign.blocked.still'])).toBeNull();
});

test('"Check again" that finds the CLA withdrawn replaces the page with the neutral state, with focus on its heading', async () => {
  const { user } = await openBlocked(failure(409, 'no_active_cla'));
  await user.click(checkAgain());
  const heading = await screen.findByRole('heading', { level: 1, name: messages['sign.noCla.title'] });
  await waitFor(() => {
    expect(heading).toHaveFocus();
  });
  expect(screen.queryByRole('article')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('a person who cannot sign for a reason the page does not know gets the form-less state and can ask again', async () => {
  serveSign({ context: contextResponse({ canSign: false }) });
  const contexts = answer(signContextRoute.path, contextResponse({ canSign: false }), contextResponse());
  const { user } = await openSignPage();
  const panel = within(pageMain()).getByRole('status');
  expect(within(panel).getByText(messages['sign.cannot.message'])).toBeInTheDocument();
  await user.click(within(panel).getByRole('button', { name: messages['sign.blocked.check'] }));
  await formHeading();
  expect(contexts).toHaveLength(2);
});

test('the verified addresses of the new context are the ones offered', async () => {
  const { user } = await openBlocked(json(contextOf({ emails: [{ email: 'new@example.org', primary: true }] })));
  await user.click(checkAgain());
  await formHeading();
  expect(screen.getByRole('radio', { name: (name) => name.startsWith('new@example.org') })).toBeChecked();
});

test('the blocked state passes axe, before and after asking again', async () => {
  const { user, container } = await openBlocked(HttpResponse.json(contextOf()));
  await expectNoA11yViolations(container);
  await user.click(checkAgain());
  await formHeading();
  await expectNoA11yViolations(container);
});
