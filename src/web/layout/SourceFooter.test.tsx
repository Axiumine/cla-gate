// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { delay, HttpResponse, http } from 'msw';
import { expect, test, vi } from 'vitest';
import { DEFAULT_SOURCE_URL, metaRoute } from '../../shared/meta.ts';
import { messages } from '../i18n/index.ts';
import { META_KEY } from '../meta/meta.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { server } from '../test-support/server.ts';
import { SourceFooter } from './SourceFooter.tsx';

// E17-S09: the AGPL section 13 offer of the corresponding source of the running version, in the footer of every page.

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const REPOSITORY = 'https://git.example.test/org/cla';

const sourceLink = () => screen.findByRole('link', { name: messages['footer.sourceCode'] });
const footer = () => screen.getByRole('contentinfo');

test('with the commit known, "Source code" links to its tree, the first seven characters are in <code>, and the licence is named', async () => {
  renderWithProviders(<SourceFooter />, { meta: { sourceUrl: REPOSITORY, commit: COMMIT, installUrl: null } });
  expect(await screen.findByText(COMMIT.slice(0, 7))).toBeInTheDocument();
  expect(screen.getByRole('link', { name: messages['footer.sourceCode'] })).toHaveAttribute(
    'href',
    `${REPOSITORY}/tree/${COMMIT}`,
  );
  const code = footer().querySelector('code');
  expect(code?.textContent).toBe('0123456');
  expect(footer()).toHaveTextContent('AGPL-3.0-only');
  expect(footer().textContent).not.toContain(COMMIT);
});

test('with no commit known it links to the repository itself and shows no commit', async () => {
  renderWithProviders(<SourceFooter />, { meta: { sourceUrl: REPOSITORY, commit: null, installUrl: null } });
  const link = await sourceLink();
  await waitFor(() => {
    expect(link).toHaveAttribute('href', REPOSITORY);
  });
  expect(footer().querySelector('code')).toBeNull();
});

test('the link opens nothing behind the page and tells the other site nothing: noopener and noreferrer', async () => {
  renderWithProviders(<SourceFooter />);
  const link = await sourceLink();
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(link).not.toHaveAttribute('target');
});

test('the link is there at once, before the answer, as the compiled-in repository', () => {
  renderWithProviders(<SourceFooter />, { meta: { sourceUrl: REPOSITORY, commit: COMMIT, installUrl: null } });
  const link = screen.getByRole('link', { name: messages['footer.sourceCode'] });
  expect(link).toHaveAttribute('href', DEFAULT_SOURCE_URL);
  expect(within(footer()).queryByText(COMMIT.slice(0, 7))).toBeNull();
});

test('while the server is slow the link stays the compiled-in repository', async () => {
  const { queryClient } = renderWithProviders(<SourceFooter />);
  let asked = false;
  server.use(
    http.get(metaRoute.path, async () => {
      asked = true;
      await delay('infinite');
      return HttpResponse.json({});
    }),
  );
  await vi.waitFor(() => {
    expect(asked).toBe(true);
  });
  expect(queryClient.getQueryState(META_KEY)?.status).toBe('pending');
  expect(screen.getByRole('link', { name: messages['footer.sourceCode'] })).toHaveAttribute('href', DEFAULT_SOURCE_URL);
});

test.each([
  [
    'a server error',
    () =>
      HttpResponse.json({ error: { code: 'internal_server_error', message: 'x', requestId: 'r' } }, { status: 500 }),
  ],
  ['a network failure', () => HttpResponse.error()],
  ['an answer that is not JSON', () => new HttpResponse('<html>proxy error</html>', { status: 200 })],
  ['an answer that is not the contract', () => HttpResponse.json({ sourceUrl: 7 })],
])('when /api/meta fails with %s the footer keeps the compiled-in repository link', async (_what, answer) => {
  const { queryClient } = renderWithProviders(<SourceFooter />);
  server.use(http.get(metaRoute.path, answer));
  await vi.waitFor(() => {
    expect(queryClient.getQueryState(META_KEY)?.status).toBe('error');
  });
  expect(screen.getByRole('link', { name: messages['footer.sourceCode'] })).toHaveAttribute('href', DEFAULT_SOURCE_URL);
  expect(footer()).toHaveTextContent('AGPL-3.0-only');
});

test.each([
  ['a javascript: address', 'javascript:alert(document.domain)'],
  ['a data: address', 'data:text/html,<script>alert(1)</script>'],
  ['plain http', 'http://git.example.test/org/cla'],
  ['credentials', 'https://user:pw@git.example.test/org/cla'],
  ['a query', 'https://git.example.test/org/cla?next=//evil.example'],
])(
  'a hostile source address (%s) is never an href: the footer links to the compiled-in repository',
  async (_what, sourceUrl) => {
    const { queryClient } = renderWithProviders(<SourceFooter />);
    server.use(http.get(metaRoute.path, () => HttpResponse.json({ sourceUrl, commit: COMMIT, installUrl: null })));
    // The contract refuses the answer, so the cache holds an error and the footer never saw the address.
    await vi.waitFor(() => {
      expect(queryClient.getQueryState(META_KEY)?.status).toBe('error');
    });
    const hrefs = [...document.querySelectorAll('a')].map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual([DEFAULT_SOURCE_URL]);
    expect(footer().querySelector('code')).toBeNull();
  },
);

test('the footer passes axe', async () => {
  const { container } = renderWithProviders(<SourceFooter />, {
    meta: { sourceUrl: REPOSITORY, commit: COMMIT, installUrl: null },
  });
  await screen.findByText(COMMIT.slice(0, 7));
  await expectNoA11yViolations(container);
});
