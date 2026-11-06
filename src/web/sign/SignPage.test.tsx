// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  CONTEXT_KEY,
  contextOf,
  contextResponse,
  failure,
  openSignPage,
  renderSign,
  SHA,
  serveSign,
  TWO_EMAILS,
  tabTo,
} from './test-support.ts';

// E18-S01: the sign page reads the CLA of the repository through the typed client and shows what the person is about to
// agree to: the document, the version, when it was published, the text, and the fingerprint of the text.

test('it asks for the context of the repository of the link, with the pull request of the link', async () => {
  const calls = serveSign();
  await openSignPage('/sign/123?pr=45');
  expect(calls.context).toHaveLength(1);
  const url = new URL(calls.context[0]?.url ?? '');
  expect(url.pathname).toBe('/api/sign/123');
  expect(url.search).toBe('?pr=45');
  expect(calls.context[0]?.method).toBe('GET');
});

test('a link without a pull request asks without one', async () => {
  const calls = serveSign({ context: contextResponse({ pr: null, prUrl: null }) });
  const { queryClient } = await openSignPage('/sign/123');
  expect(new URL(calls.context[0]?.url ?? '').search).toBe('');
  expect(queryClient.getQueryCache().find({ queryKey: ['sign', 'context', 123, null], exact: true })).toBeDefined();
});

test('the context sits in the cache under the repository and the pull request, which is what the other tests write to', async () => {
  serveSign();
  const { queryClient } = await openSignPage('/sign/123?pr=45');
  expect(queryClient.getQueryCache().find({ queryKey: CONTEXT_KEY, exact: true })).toBeDefined();
});

test.each(['abc', '0', '-5', '1.5', '45x', '00045', '2147483648', '%20'])(
  'a ?pr= of %s is dropped, and the page still loads the CLA of the repository',
  async (pr) => {
    const calls = serveSign({ context: contextResponse({ pr: null, prUrl: null }) });
    await openSignPage(`/sign/123?pr=${pr}`);
    expect(new URL(calls.context[0]?.url ?? '').search).toBe('');
  },
);

test.each(['abc', '0', '-1', '1e3', '0x10', '007', '1.0', '9007199254740993', '123abc'])(
  'the repository id %s is no page of the app: it is the not-found page, and nothing is asked',
  async (id) => {
    const calls = serveSign();
    renderSign(`/sign/${id}`);
    expect(
      await screen.findByRole('heading', { level: 1, name: messages['states.notFound.title'] }),
    ).toBeInTheDocument();
    expect(calls.context).toHaveLength(0);
  },
);

test('it shows the document name as the one h1, the version as major.minor, and the publication time in UTC', async () => {
  serveSign();
  await openSignPage();
  const headings = screen.getAllByRole('heading', { level: 1 });
  expect(headings).toHaveLength(1);
  expect(headings[0]).toHaveTextContent('Individual CLA');
  expect(headings[0]?.querySelector('bdi')).toHaveTextContent('Individual CLA');
  expect(screen.getByText('2.1')).toBeInTheDocument();
  const published = screen.getByText('2026-11-01 10:00 UTC');
  expect(published.tagName).toBe('TIME');
  expect(published).toHaveAttribute('datetime', '2026-11-01T10:00:00.000Z');
  expect(screen.getByText('acme/widgets')).toBeInTheDocument();
});

test('the document title is the title of the sign route', async () => {
  serveSign();
  await openSignPage();
  expect(document.title).toBe(`${messages['sign.title']} · CLA`);
});

test('the CLA text is in a labelled article that a keyboard can scroll, and its headings are one level below the h1', async () => {
  serveSign();
  await openSignPage();
  const article = screen.getByRole('article', { name: messages['sign.text.label'] });
  expect(article).toHaveAttribute('tabindex', '0');
  expect(
    within(article).getByRole('heading', { level: 2, name: 'Individual Contributor Agreement' }),
  ).toBeInTheDocument();
  expect(within(article).getByRole('heading', { level: 3, name: '1. Grant' })).toBeInTheDocument();
  expect(within(article).queryByRole('heading', { level: 1 })).toBeNull();
  expect(within(article).getByText('This agreement is between you and <company name>.')).toBeInTheDocument();
  expect(within(article).getAllByRole('listitem')).toHaveLength(2);
  const link = within(article).getByRole('link', { name: 'the policy' });
  expect(link).toHaveAttribute('href', 'https://example.org/policy');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  expect(link).toHaveAttribute('target', '_blank');
});

test('a keyboard user can reach the article and scroll it', async () => {
  serveSign();
  const { user } = await openSignPage();
  const article = screen.getByRole('article', { name: messages['sign.text.label'] });
  await tabTo(user, article);
  expect(article).toHaveFocus();
});

test('the fingerprint is sha256: and the first 12 characters, the whole hash is in a closed disclosure, and the page says what it covers', async () => {
  serveSign();
  const { user } = await openSignPage();
  expect(screen.getByText(`sha256:${SHA.slice(0, 12)}`)).toBeInTheDocument();
  expect(screen.getByText(messages['sign.fingerprint.covers'])).toBeInTheDocument();
  const details = screen.getByText(`sha256:${SHA}`).closest('details');
  expect(details).not.toBeNull();
  expect(details).toContainElement(screen.getByText(messages['sign.fingerprint.show']));
  expect(details).not.toHaveAttribute('open');
  await user.click(screen.getByText(messages['sign.fingerprint.show']));
  expect(details).toHaveAttribute('open');
});

test('the rationale of the version is shown when the person must sign again, and not otherwise', async () => {
  serveSign({
    context: contextResponse({
      state: 'resign_required',
      signature: { id: 5, major: 1, minor: 0, signedAt: '2026-01-01T00:00:00.000Z' },
    }),
  });
  await openSignPage();
  expect(screen.getByText(messages['sign.rationale'])).toBeInTheDocument();
  expect(screen.getByText('Clarified the patent grant')).toBeInTheDocument();
});

test('the rationale is not shown for a person who has nothing to sign again', async () => {
  serveSign();
  await openSignPage();
  expect(screen.queryByText('Clarified the patent grant')).toBeNull();
  expect(screen.queryByText(messages['sign.rationale'])).toBeNull();
});

test('an empty rationale is not shown, even when the person must sign again', async () => {
  serveSign({
    context: contextResponse({
      state: 'resign_required',
      signature: { id: 5, major: 1, minor: 0, signedAt: '2026-01-01T00:00:00.000Z' },
      version: { ...contextOf().version, rationale: '' },
    }),
  });
  await openSignPage();
  expect(screen.queryByText(messages['sign.rationale'])).toBeNull();
});

test('the page passes axe, with one address and with several', async () => {
  serveSign({ context: contextResponse({ emails: TWO_EMAILS }) });
  const { container } = await openSignPage();
  await expectNoA11yViolations(container);
});

test.each([
  [500, 'internal_server_error'],
  [404, 'not_found'],
  [429, 'too_many_requests'],
])('a %i answer is an error state with the request id and no form', async (status, code) => {
  serveSign({ context: failure(status, code) });
  renderSign();
  expect(await screen.findByRole('alert')).toHaveTextContent('req-00000001');
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByRole('article')).toBeNull();
});
