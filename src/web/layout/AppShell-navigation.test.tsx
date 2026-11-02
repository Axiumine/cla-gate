// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Link, useLocation } from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DEFAULT_SOURCE_URL } from '../../shared/meta.ts';
import { messages } from '../i18n/index.ts';
import { AppRouter } from '../router.tsx';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { TestAppRoutes } from '../test-support/app-routes.tsx';
import { renderWithProviders } from '../test-support/render.tsx';

// E17-S09: what the shell does when the page changes: focus, document title and the live region; and that the footer is
// on every kind of page.

/** A page without a heading: focus goes to <main>. */
function Headingless() {
  return (
    <p>
      <Link to="/login/failed">Open the page with a heading</Link>
    </p>
  );
}

function WithHeading() {
  const search = useLocation({ select: (location) => location.searchStr });
  return (
    <>
      <h1>The heading</h1>
      <Link to="/">Back to the page without</Link>
      <Link to="/login/failed" search={{ reason: 'access_denied' }}>
        Same page, other search
      </Link>
      <output>{`search ${search}`}</output>
    </>
  );
}

function Crash(): never {
  throw new Error('a page that cannot render');
}

const pages = [
  { path: '/', access: 'public', component: Headingless, title: 'landing.title' },
  { path: '/login/failed', access: 'public', component: WithHeading, title: 'login.failed.title' },
  { path: '/crash', access: 'public', component: Crash, title: 'nav.menu' },
] as const;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const main = () => screen.getByRole('main');
/** The shell's live region: the status node that holds the title of the page. */
const announcement = (title: string) => screen.getByText(title, { selector: '[role="status"]' });

test('the first load is not a navigation: focus stays where the browser put it, so Tab reaches "Skip to content" first', async () => {
  const { user } = renderWithProviders(<TestAppRoutes route="/login/failed" pages={pages} />);
  await screen.findByRole('heading', { level: 1, name: 'The heading' });
  expect(document.body).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('link', { name: messages['nav.skip'] })).toHaveFocus();
});

test('after a navigation the <h1> of the new page has focus', async () => {
  const { user } = renderWithProviders(<TestAppRoutes route="/" pages={pages} />);
  await user.click(await screen.findByRole('link', { name: 'Open the page with a heading' }));
  const heading = await screen.findByRole('heading', { level: 1, name: 'The heading' });
  await waitFor(() => {
    expect(heading).toHaveFocus();
  });
  expect(heading).toHaveAttribute('tabindex', '-1');
});

test('a page with no <h1> gets <main> focused instead', async () => {
  const { user } = renderWithProviders(<TestAppRoutes route="/login/failed" pages={pages} />);
  await user.click(await screen.findByRole('link', { name: 'Back to the page without' }));
  await screen.findByRole('link', { name: 'Open the page with a heading' });
  await waitFor(() => {
    expect(main()).toHaveFocus();
  });
});

test('going back and forth moves focus each time, to the <h1> and then to <main>', async () => {
  const { user } = renderWithProviders(<TestAppRoutes route="/" pages={pages} />);
  await user.click(await screen.findByRole('link', { name: 'Open the page with a heading' }));
  await waitFor(() => {
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
  });
  await user.click(screen.getByRole('link', { name: 'Back to the page without' }));
  await waitFor(() => {
    expect(main()).toHaveFocus();
  });
});

test('a change of the search alone leaves focus where it is', async () => {
  const { user } = renderWithProviders(<TestAppRoutes route="/login/failed" pages={pages} />);
  const link = await screen.findByRole('link', { name: 'Same page, other search' });
  await user.click(link);
  await screen.findByText('search ?reason=access_denied');
  expect(link).toHaveFocus();
});

test('the title of the tab is "<page title> · CLA" from the catalog, and follows each navigation', async () => {
  const { user } = renderWithProviders(<TestAppRoutes route="/" pages={pages} />);
  await screen.findByRole('link', { name: 'Open the page with a heading' });
  await waitFor(() => {
    expect(document.title).toBe(`${messages['landing.title']} · CLA`);
  });
  await user.click(screen.getByRole('link', { name: 'Open the page with a heading' }));
  await waitFor(() => {
    expect(document.title).toBe(`${messages['login.failed.title']} · CLA`);
  });
});

test('a polite live region says the title of each new page, and it was in the page before the title changed', async () => {
  const { user } = renderWithProviders(<TestAppRoutes route="/" pages={pages} />);
  await screen.findByRole('link', { name: 'Open the page with a heading' });
  const region = announcement(messages['landing.title']);
  expect([region.getAttribute('aria-live'), region.getAttribute('aria-atomic')]).toEqual(['polite', 'true']);
  expect(region).toHaveClass('sr-only');
  await user.click(screen.getByRole('link', { name: 'Open the page with a heading' }));
  await waitFor(() => {
    expect(region).toHaveTextContent(messages['login.failed.title']);
  });
  expect(region).toBeInTheDocument();
});

test('an unknown path is announced and titled as the not-found page, with focus on its heading', async () => {
  renderWithProviders(<AppRouter />, { route: '/no/such/page' });
  expect(await screen.findByRole('heading', { level: 1, name: messages['states.notFound.title'] })).toBeInTheDocument();
  await waitFor(() => {
    expect(document.title).toBe(`${messages['states.notFound.title']} · CLA`);
  });
  expect(announcement(messages['states.notFound.title'])).toBeInTheDocument();
});

test.each([
  ['the landing page', '/'],
  ['the failed-login page', '/login/failed?reason=access_denied'],
  ['the not-found page', '/no/such/page'],
])('the source footer is on %s, with the offer of the source', async (_name, route) => {
  renderWithProviders(<AppRouter />, { route });
  const footer = await screen.findByRole('contentinfo');
  expect(within(footer).getByRole('link', { name: messages['footer.sourceCode'] })).toHaveAttribute(
    'href',
    DEFAULT_SOURCE_URL,
  );
  expect(footer).toHaveTextContent('AGPL-3.0-only');
});

test('the footer names the running commit on every page once /api/meta has answered', async () => {
  const commit = 'abcdef0123456789abcdef0123456789abcdef01';
  renderWithProviders(<AppRouter />, {
    route: '/no/such/page',
    meta: { sourceUrl: DEFAULT_SOURCE_URL, commit, installUrl: null },
  });
  const footer = await screen.findByRole('contentinfo');
  await waitFor(() => {
    expect(within(footer).getByRole('link', { name: messages['footer.sourceCode'] })).toHaveAttribute(
      'href',
      `${DEFAULT_SOURCE_URL}/tree/${commit}`,
    );
  });
  expect(footer.querySelector('code')).toHaveTextContent('abcdef0');
});

test('a page that crashes is replaced by the error state inside the shell: header, user menu and footer stay', async () => {
  renderWithProviders(<TestAppRoutes route="/crash" pages={pages} />);
  const alert = await screen.findByRole('alert');
  expect(main()).toContainElement(alert);
  expect(screen.getByRole('banner')).toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: messages['nav.label'] })).toBeInTheDocument();
  expect(screen.getByRole('radiogroup', { name: messages['theme.label'] })).toBeInTheDocument();
  expect(
    within(screen.getByRole('contentinfo')).getByRole('link', { name: messages['footer.sourceCode'] }),
  ).toBeInTheDocument();
});

test('the shell around an error page and a not-found page passes axe', async () => {
  const crashed = renderWithProviders(<TestAppRoutes route="/crash" pages={pages} />);
  await crashed.findByRole('alert');
  await expectNoA11yViolations(crashed.container);
  crashed.unmount();
  const missing = renderWithProviders(<AppRouter />, { route: '/no/such/page' });
  await missing.findByRole('heading', { level: 1, name: messages['states.notFound.title'] });
  await expectNoA11yViolations(missing.container);
});
