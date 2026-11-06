// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { assert, expect, test } from 'vitest';
import { envelope } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  globex,
  heading,
  renderInstallations,
  repositoriesOf,
  repositoriesTable,
  repository,
  rowStartingWith,
  serveTenants,
  summary,
  tenantOf,
} from './test-support.ts';

// E18-S04: one tenant at /installations/$installationId: the account, what the list says of it, and its first repositories.

const ACME = summary();

test('it asks for the first ten repositories of the installation in the address and for nothing else', async () => {
  const served = serveTenants([tenantOf(ACME, 'acme/widgets')]);
  renderInstallations('/installations/5');
  await heading('acme');
  expect(
    served.repositories.map((seen) => [seen.method, new URL(seen.url).pathname, new URL(seen.url).search]),
  ).toEqual([['GET', '/api/installations/5/repositories', '?limit=10']]);
});

test('the account login is the one h1, and the facts are the type, the role as a badge and the counts', async () => {
  serveTenants([tenantOf(ACME, 'acme/widgets')]);
  renderInstallations('/installations/5');
  await heading('acme');
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  const facts = screen.getByText(messages['installation.facts.type']).closest('dl');
  assert.isNotNull(facts);
  expect(facts).toHaveTextContent(messages['installations.type.organization']);
  expect(within(facts).getByText(messages['status.org_admin'])).toBeInTheDocument();
  expect(facts).toHaveTextContent('12 in all, 3 enforcing the CLA');
  expect(within(facts).queryByText(messages['status.suspended'])).toBeNull();
});

test('a repo admin is told so, and a suspended installation shows the banner and the badge', async () => {
  serveTenants([tenantOf(globex({ suspended: true }), 'globex/api')]);
  renderInstallations('/installations/6');
  await heading('globex');
  expect(screen.getAllByText(messages['status.repo_admin'])).toHaveLength(1);
  expect(screen.getByText(messages['status.suspended'])).toBeInTheDocument();
  expect(screen.getByText(messages['installation.suspended'], { selector: '[role="status"]' })).toBeInTheDocument();
});

test('an installation that is not suspended shows no banner', async () => {
  serveTenants([tenantOf(ACME, 'acme/widgets')]);
  renderInstallations('/installations/5');
  await heading('acme');
  expect(screen.queryByText(messages['installation.suspended'])).toBeNull();
});

test('the repositories are a table with a caption, the name as text and an Enabled or Disabled badge', async () => {
  serveTenants([
    {
      summary: ACME,
      answer: () =>
        repositoriesOf([
          repository(1, 'acme/widgets'),
          repository(2, 'acme/gadgets', { enabled: false, canAdminister: false }),
        ]),
    },
  ]);
  renderInstallations('/installations/5');
  await screen.findByRole('table');
  expect(within(repositoriesTable()).getAllByRole('row')).toHaveLength(3);
  expect(within(rowStartingWith('acme/widgets')).getByText(messages['status.enabled'])).toBeInTheDocument();
  expect(within(rowStartingWith('acme/gadgets')).getByText(messages['status.disabled'])).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { level: 2, name: messages['installation.repositories.title'] }),
  ).toBeInTheDocument();
});

test('a longer list says that only the first repositories are shown; a complete one does not', async () => {
  serveTenants([{ summary: ACME, answer: () => repositoriesOf([repository(1, 'acme/widgets')], 'next-page') }]);
  const more = renderInstallations('/installations/5');
  expect(await screen.findByText('Only the first 1 repositories are shown.')).toBeInTheDocument();
  more.unmount();
  serveTenants([tenantOf(ACME, 'acme/widgets')]);
  renderInstallations('/installations/5');
  await screen.findByRole('table');
  expect(screen.queryByText(/Only the first/)).toBeNull();
});

test('an installation with no repositories shows the empty state under the repositories heading', async () => {
  serveTenants([tenantOf(ACME)]);
  renderInstallations('/installations/5');
  expect(
    await screen.findByRole('heading', { level: 3, name: messages['installation.repositories.empty.title'] }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
});

test('an installation the list does not hold, which the server still serves, is titled "Installation" and shows no facts', async () => {
  const unlisted = summary({ id: 9, accountLogin: 'elsewhere' });
  serveTenants([{ summary: unlisted, answer: () => repositoriesOf([repository(1, 'x/y')]) }], () => Response.json([]));
  renderInstallations('/installations/9');
  expect(await heading(messages['installation.title'])).toBeInTheDocument();
  expect(await screen.findByText('x/y')).toBeInTheDocument();
  expect(screen.queryByText(messages['installation.facts.type'])).toBeNull();
  expect(screen.queryByText('elsewhere')).toBeNull();
});

test('an installation the person has no role in, which the server answers 404 for, shows that state at level one with the request id and nothing of the tenant', async () => {
  serveTenants([tenantOf(globex(), 'globex/api')]);
  renderInstallations('/installations/5');
  const state = await screen.findByRole('alert');
  expect(within(state).getByRole('heading', { level: 1 })).toBeInTheDocument();
  expect(state).toHaveTextContent(messages['errors.not_found']);
  expect(state).toHaveTextContent('req-00000001');
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByText('globex/api')).toBeNull();
  expect(screen.queryByText(messages['installation.facts.type'])).toBeNull();
});

test("a role that is not enough (403) shows the forbidden state at level one, with the request id, and none of the tenant's data", async () => {
  serveTenants([{ summary: ACME, answer: () => envelope(403, 'forbidden') }]);
  renderInstallations('/installations/5');
  const state = await screen.findByRole('alert');
  expect(within(state).getByRole('heading', { level: 1 })).toBeInTheDocument();
  expect(state).toHaveTextContent(messages['errors.forbidden']);
  expect(state).toHaveTextContent('req-00000001');
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByText(messages['installation.facts.type'])).toBeNull();
  expect(screen.queryByRole('heading', { level: 1, name: 'acme' })).toBeNull();
});

test('a forbidden installation has the forbidden heading and no "Try again", a missing one has the general heading and does', async () => {
  serveTenants([{ summary: ACME, answer: () => envelope(403, 'forbidden') }]);
  const forbidden = renderInstallations('/installations/5');
  expect(
    await screen.findByRole('heading', { level: 1, name: messages['states.forbidden.title'] }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: messages['states.retry'] })).toBeNull();
  forbidden.unmount();
  serveTenants([]);
  renderInstallations('/installations/5');
  expect(await screen.findByRole('heading', { level: 1, name: messages['states.error.title'] })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: messages['states.retry'] })).toBeInTheDocument();
});

test.each(['/installations/abc', '/installations/0', '/installations/05', '/installations/1e3', '/installations/-4'])(
  '%s is no installation of the app: it is the not-found page, and nothing is asked of the server',
  async (route) => {
    const served = serveTenants([tenantOf(ACME, 'acme/widgets')]);
    renderInstallations(route);
    expect(await heading(messages['states.notFound.title'])).toBeInTheDocument();
    expect(served.repositories).toEqual([]);
  },
);

test('the overview passes axe', async () => {
  serveTenants([tenantOf(globex({ suspended: true }), 'globex/api')]);
  const { container } = renderInstallations('/installations/6');
  await screen.findByRole('table');
  await expectNoA11yViolations(container);
});

test('its error state passes axe', async () => {
  serveTenants([]);
  const { container } = renderInstallations('/installations/5');
  await screen.findByRole('alert');
  await expectNoA11yViolations(container);
});
