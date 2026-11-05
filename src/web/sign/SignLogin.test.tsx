// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { cleanup, screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { failure, pageMain, renderSign, renderSignAnonymous, serveSign } from './test-support.ts';

// E18-S02: a visitor who is not logged in. The context endpoint answers 401, so no text of the CLA is loaded; the page explains
// what signing involves and offers the login, which comes back to the same page with the same search.

/** The page for a visitor: the login prompt, once the context endpoint has said 401. */
async function openAnonymous(route?: string) {
  const calls = serveSign({ context: failure(401, 'unauthorized') });
  const rendered = renderSignAnonymous(route);
  const heading = await screen.findByRole('heading', { level: 1, name: messages['sign.login.title'] });
  return { ...rendered, calls, heading };
}

/** The "Log in with GitHub" link of the page itself (the header of the shell has one too). */
const pageLoginLink = () => within(pageMain()).getByRole('link', { name: messages['auth.login'] });

test('a visitor gets the login prompt as the one h1, and nothing of the CLA is loaded or shown', async () => {
  const { calls } = await openAnonymous();
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(calls.context).toHaveLength(1);
  expect(calls.sign).toHaveLength(0);
  expect(screen.queryByRole('article')).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByText('Individual CLA')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('the prompt says what signing involves, in steps, and what the maintainers can see', async () => {
  await openAnonymous();
  const steps = within(pageMain()).getAllByRole('listitem');
  expect(steps.map((step) => step.textContent)).toEqual([
    messages['sign.login.step.account'],
    messages['sign.login.step.read'],
    messages['sign.login.step.visible'],
  ]);
  expect(within(pageMain()).getByText(messages['sign.login.intro'])).toBeInTheDocument();
  expect(within(pageMain()).getByText(messages['sign.login.after'])).toBeInTheDocument();
});

test('the prompt is an informational status and not an alert', async () => {
  await openAnonymous();
  expect(within(pageMain()).getByRole('status')).toHaveTextContent(messages['sign.login.title']);
  expect(screen.queryByRole('alert')).toBeNull();
});

test('"Log in with GitHub" returns to the page itself, with the pull request', async () => {
  await openAnonymous('/sign/123?pr=45');
  const href = pageLoginLink().getAttribute('href') ?? '';
  expect(new URL(href, 'http://localhost').pathname).toBe('/api/auth/login');
  expect(new URL(href, 'http://localhost').searchParams.get('return_to')).toBe('/sign/123?pr=45');
});

test('a link without a pull request returns to the page without one', async () => {
  await openAnonymous('/sign/123');
  const href = pageLoginLink().getAttribute('href') ?? '';
  expect(new URL(href, 'http://localhost').searchParams.get('return_to')).toBe('/sign/123');
});

test('a ?pr= that is not a pull request number is not carried through the login', async () => {
  await openAnonymous('/sign/123?pr=abc');
  const href = pageLoginLink().getAttribute('href') ?? '';
  expect(new URL(href, 'http://localhost').searchParams.get('return_to')).toBe('/sign/123');
});

test('after the login round trip the same page loads with the same search parameters', async () => {
  const { calls } = await openAnonymous('/sign/123?pr=45');
  const returnTo = new URL(pageLoginLink().getAttribute('href') ?? '', 'http://localhost').searchParams.get(
    'return_to',
  );
  cleanup();
  const loggedIn = serveSign();
  renderSign(returnTo ?? '/');
  expect(await screen.findByRole('heading', { level: 1, name: 'Individual CLA' })).toBeInTheDocument();
  expect(loggedIn.context).toHaveLength(1);
  expect(new URL(loggedIn.context[0]?.url ?? '').search).toBe('?pr=45');
  expect(calls.context).toHaveLength(1);
  expect(screen.queryByText(messages['sign.login.title'])).toBeNull();
});

test('the login prompt passes axe', async () => {
  const { container } = await openAnonymous();
  await expectNoA11yViolations(container);
});
