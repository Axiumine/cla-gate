// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { CSRF_TOKEN } from '../test-support/session.ts';
import {
  bodyOf,
  confirmation,
  consentBox,
  contextResponse,
  nameInput,
  openFilled,
  releaseAndConfirm,
  SHA,
  serveHeldSign,
  serveSign,
  signButton,
  signedAnswer,
  signThrough,
  signUp,
  TWO_EMAILS,
} from './test-support.ts';

// E18-S01: the sign request, the double submit, and what the page shows when the signature is recorded.

test('the request carries the version and the hash of the text on screen, the consent id as sent, the cleaned name and the address', async () => {
  const calls = serveSign();
  await signUp(calls, undefined, '  Ada   Lovelace ');
  expect(bodyOf(calls.sign)).toStrictEqual({
    githubRepoId: 123,
    prNumber: 45,
    versionId: 31,
    contentSha256: SHA,
    consentTextId: 'individual-v1',
    name: 'Ada Lovelace',
    email: 'ada@example.org',
  });
  expect(calls.sign[0]?.method).toBe('POST');
  expect(new URL(calls.sign[0]?.url ?? '').pathname).toBe('/api/sign');
});

test('the request has the CSRF token of the session and no other credential in its headers', async () => {
  const calls = serveSign();
  await signUp(calls);
  expect(calls.sign[0]?.headers['x-csrf-token']).toBe(CSRF_TOKEN);
  expect(calls.sign[0]?.headers['content-type']).toBe('application/json');
  expect(calls.sign[0]?.headers['authorization']).toBeUndefined();
});

test('a link without a pull request signs without a pull request number', async () => {
  const calls = serveSign({ context: contextResponse({ pr: null, prUrl: null }) });
  await signUp(calls, '/sign/123');
  expect(bodyOf(calls.sign)).not.toHaveProperty('prNumber');
});

test('the address that is sent is the one that was chosen', async () => {
  const calls = serveSign({ context: contextResponse({ emails: TWO_EMAILS }) });
  const { user } = await openFilled();
  await user.click(screen.getByRole('radio', { name: (name) => name.startsWith('lovelace@example.net') }));
  await user.click(signButton());
  await waitFor(() => {
    expect(calls.sign).toHaveLength(1);
  });
  expect(bodyOf(calls.sign)).toMatchObject({ email: 'lovelace@example.net' });
});

test('while the request is pending the button is busy, the typed name stays, and a double click sends one request', async () => {
  serveSign();
  const held = serveHeldSign();
  const { user } = await openFilled();
  await user.dblClick(signButton());
  await waitFor(() => {
    expect(signButton()).toHaveAttribute('aria-busy', 'true');
  });
  expect(nameInput()).toHaveValue('Ada Lovelace');
  expect(consentBox()).toBeChecked();
  await releaseAndConfirm(held);
});

test('while the request is pending a repeated Enter key sends no second request', async () => {
  serveSign();
  const held = serveHeldSign();
  const { user } = await openFilled();
  nameInput().focus();
  await user.keyboard('{Enter}{Enter}{Enter}');
  await waitFor(() => {
    expect(held.received).toHaveLength(1);
  });
  expect(signButton()).toHaveAttribute('aria-busy', 'true');
  await releaseAndConfirm(held);
});

test('a submit that bypasses the button, sent twice at once, still sends one request', async () => {
  serveSign();
  const held = serveHeldSign();
  await openFilled();
  fireEvent.submit(nameInput());
  fireEvent.submit(nameInput());
  await waitFor(() => {
    expect(held.received).toHaveLength(1);
  });
  await releaseAndConfirm(held);
});

test('the pending page announces nothing wrong and passes axe', async () => {
  serveSign();
  const held = serveHeldSign();
  const { user, container } = await openFilled();
  await user.click(signButton());
  await waitFor(() => {
    expect(held.received).toHaveLength(1);
  });
  await expectNoA11yViolations(container);
  expect(screen.queryByRole('alert')).toBeNull();
});

test('a recorded signature replaces the form with a confirmation whose heading has focus', async () => {
  serveSign();
  const { heading } = await signThrough();
  expect(heading).toHaveFocus();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('button', { name: messages['sign.submit'] })).toBeNull();
  expect(screen.getByText('2026-11-02 09:30 UTC')).toBeInTheDocument();
  expect(screen.getAllByText('2.1').length).toBeGreaterThan(0);
  expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  expect(screen.getByText(messages['sign.done.update'])).toBeInTheDocument();
  expect(screen.queryByText(messages['sign.done.existing'])).toBeNull();
  expect(screen.getByRole('link', { name: messages['sign.done.pullRequest'] })).toHaveAttribute(
    'href',
    'https://github.com/acme/widgets/pull/45',
  );
});

test('the page keeps one h1 and the CLA text after the confirmation', async () => {
  serveSign();
  await signThrough();
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.getByRole('article', { name: messages['sign.text.label'] })).toBeInTheDocument();
});

test('the same major version signed in another tab (200, created: false) shows the confirmation of that signature', async () => {
  serveSign({ sign: signedAnswer(false, { minor: 0, signedAt: '2026-10-30T08:15:00.000Z' }) });
  const { heading } = await signThrough();
  expect(heading).toHaveFocus();
  expect(screen.getByText('2026-10-30 08:15 UTC')).toBeInTheDocument();
  expect(screen.getByText(messages['sign.done.existing'])).toBeInTheDocument();
  expect(screen.getByText('2.0')).toBeInTheDocument();
});

test.each([
  ['there is none', null],
  ['it is not on github.com', 'https://evil.example/acme/widgets/pull/45'],
  ['it is on a look-alike host', 'https://github.com.evil.example/acme/widgets/pull/45'],
  ['it carries credentials', 'https://github.com@evil.example/pull/45'],
  // eslint-disable-next-line sonarjs/no-clear-text-protocols -- the point of the row: an http address is refused
  ['it is not https', 'http://github.com/acme/widgets/pull/45'],
  ['it is a script', 'javascript:alert(1)'],
])('the confirmation has no link to the pull request when %s', async (_label, prUrl) => {
  serveSign({ context: contextResponse({ prUrl }) });
  await signThrough();
  expect(screen.queryByRole('link', { name: messages['sign.done.pullRequest'] })).toBeNull();
  expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
});

test('the confirmation passes axe', async () => {
  serveSign();
  const { container } = await signThrough();
  await expectNoA11yViolations(container);
});

test('once signed, no copy of the typed name or address stays in the cache, and the context is marked out of date without being asked again', async () => {
  const calls = serveSign();
  const { queryClient } = await signThrough(undefined, 'Zzzz Typed');
  await waitFor(() => {
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
  });
  const cached = JSON.stringify(
    queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.state.data),
  );
  expect(cached).not.toContain('Zzzz Typed');
  expect(calls.context).toHaveLength(1);
  const contexts = queryClient.getQueryCache().findAll({ queryKey: ['sign', 'context', 123] });
  expect(contexts.map((query) => query.state.isInvalidated)).toEqual([true]);
  expect(await confirmation()).toBeInTheDocument();
});
