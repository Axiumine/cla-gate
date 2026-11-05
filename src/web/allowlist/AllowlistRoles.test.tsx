// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { envelope } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import {
  githubDown,
  globex,
  repositoriesOf,
  repository,
  summary,
  type Tenant,
  tenantOf,
} from '../installations/test-support.ts';
import {
  addButton,
  heading,
  openAllowlist,
  pathOf,
  renderAllowlist,
  scopeSelect,
  serveAllowlist,
} from './test-support.ts';

// E18-S06: what each role sees. An org admin manages the whole installation and every repository; a repo admin has no whole-installation
// scope and chooses one of the repositories they administer, which the list of repositories says through `canAdminister`.

/** The tenant `globex`, where the person is a repo admin of `globex/a` and not of `globex/b`. */
const GLOBEX: Tenant = {
  summary: globex(),
  answer: () => repositoriesOf([repository(1, 'globex/a'), repository(2, 'globex/b', { canAdminister: false })]),
};

const GLOBEX_ROUTE = '/installations/6/allowlist';

test('an org admin has the whole installation first and every repository of the tenant', async () => {
  await openAllowlist('/installations/5/allowlist');
  expect(
    within(scopeSelect())
      .getAllByRole('option')
      .map((option) => option.textContent),
  ).toEqual([messages['allowlist.scope.installation'], 'acme/widgets', 'acme/gadgets']);
});

test('a repo admin has no whole-installation scope: the select asks to choose a repository, with only theirs, and nothing is listed or asked for yet', async () => {
  const served = serveAllowlist({ tenants: [GLOBEX] });
  renderAllowlist(GLOBEX_ROUTE);
  await heading(messages['allowlist.title']);
  expect(await screen.findByRole('heading', { level: 2, name: messages['allowlist.pick.title'] })).toBeInTheDocument();
  expect(
    within(scopeSelect())
      .getAllByRole('option')
      .map((option) => [option.textContent, option.matches(':disabled')]),
  ).toEqual([
    [messages['allowlist.scope.choose'], true],
    ['globex/a', false],
  ]);
  expect(scopeSelect()).toHaveValue('');
  expect(screen.queryByRole('button', { name: messages['allowlist.add'] })).toBeNull();
  expect(served.installationList).toEqual([]);
  expect(served.repositoryList).toEqual([]);
});

test('a repo admin who chooses a repository sees its entries and can add to it, and the installation list is never asked for', async () => {
  const served = serveAllowlist({ tenants: [GLOBEX] });
  const { user } = renderAllowlist(GLOBEX_ROUTE);
  await screen.findByRole('option', { name: 'globex/a' });
  await user.selectOptions(scopeSelect(), 'globex/a');
  await screen.findByRole('heading', { level: 2, name: messages['allowlist.entries.title'] });
  expect(served.repositoryList.map(pathOf)).toEqual(['/api/repositories/1/allowlist-entries']);
  expect(served.installationList).toEqual([]);
  expect(addButton()).toBeEnabled();
});

test('a repo admin who opens a repository by its address gets what the server says about it: the entries, or the forbidden state', async () => {
  serveAllowlist({ tenants: [GLOBEX], repositoryList: [envelope(403, 'forbidden')] });
  renderAllowlist(`${GLOBEX_ROUTE}?repository=2`);
  const state = await screen.findByRole('alert');
  expect(state).toHaveTextContent(messages['errors.forbidden']);
  expect(
    within(state).getByRole('heading', { level: 2, name: messages['states.forbidden.title'] }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
  expect(within(scopeSelect()).getByRole('option', { name: 'Repository 2' })).toBeInTheDocument();
});

test('the screen waits for the list of installations, which holds the role: it is loading until then', async () => {
  serveAllowlist({ listing: () => new Promise<Response>(() => undefined) });
  renderAllowlist('/installations/5/allowlist');
  expect(await screen.findByText(messages['states.loading'])).toBeInTheDocument();
  expect(screen.queryByRole('heading', { level: 1, name: messages['allowlist.title'] })).toBeNull();
});

test('when the role is not known (the list of installations failed) the whole installation is offered and the server decides', async () => {
  const served = serveAllowlist({ listing: githubDown });
  renderAllowlist('/installations/5/allowlist');
  await heading(messages['allowlist.title']);
  await screen.findByRole('heading', { level: 2, name: messages['allowlist.entries.title'] });
  expect(served.installationList).toHaveLength(1);
  expect(
    within(scopeSelect()).getByRole('option', { name: messages['allowlist.scope.installation'] }),
  ).toBeInTheDocument();
});

test('an installation the list does not hold is asked for all the same, and the server answers for it', async () => {
  serveAllowlist({
    tenants: [tenantOf(summary({ id: 9 }), 'acme/widgets')],
    installationList: [envelope(404, 'not_found')],
  });
  renderAllowlist('/installations/5/allowlist');
  expect(await screen.findByRole('alert')).toHaveTextContent(messages['errors.not_found']);
  expect(screen.queryByRole('table')).toBeNull();
});

test('the navigation of a tenant has the allowlist, the signatures and the pending list for a repo admin and, with the documents and the audit log, for an org admin', async () => {
  serveAllowlist({ tenants: [GLOBEX] });
  const first = renderAllowlist(GLOBEX_ROUTE);
  const repoNav = await screen.findByRole('navigation', { name: messages['tenant.nav.label'] });
  await within(repoNav).findByRole('link', { name: messages['tenant.nav.allowlist'] });
  expect(within(repoNav).queryByRole('link', { name: messages['tenant.nav.documents'] })).toBeNull();
  expect(within(repoNav).getByRole('link', { name: messages['tenant.nav.signatures'] })).toBeInTheDocument();
  expect(within(repoNav).getByRole('link', { name: messages['tenant.nav.pending'] })).toBeInTheDocument();
  first.unmount();
  await openAllowlist('/installations/5/allowlist');
  const orgNav = screen.getByRole('navigation', { name: messages['tenant.nav.label'] });
  expect(
    within(orgNav)
      .getAllByRole('link')
      .map((link) => link.textContent),
  ).toEqual([
    messages['tenant.nav.overview'],
    messages['tenant.nav.documents'],
    messages['tenant.nav.allowlist'],
    messages['tenant.nav.signatures'],
    messages['tenant.nav.pending'],
    messages['tenant.nav.audit'],
  ]);
});
