// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { messages } from '../i18n/index.ts';
import { repository, summary } from '../installations/test-support.ts';
import {
  claOf,
  documentSelect,
  enableButton,
  gadgets,
  heading,
  notFound,
  pageOf,
  pathOf,
  REPOSITORIES_ROUTE,
  renderRepositories,
  repositoriesTable,
  rowsOf,
  serveRepositories,
  switchedTo,
} from './test-support.ts';

// E18-S10: cross-tenant isolation in the browser. The server filters every query by tenant whatever the address says (E14); what the screen
// adds is that nothing of one tenant is drawn under another, not even while the other's answer is awaited, and that every request is
// addressed through the installation on screen or the repository of the row it came from.

/** Repositories that only one of the two tenants holds, in a form no request id or message can contain (`zzzz` is not hexadecimal). */
const A_ONLY = 'zzzz-acme/only';
const B_ONLY = 'zzzz-globex/only';
const TENANTS = [
  { summary: summary(), answer: () => pageOf([]) },
  { summary: summary({ id: 6, accountLogin: 'globex', role: 'org_admin' }), answer: () => pageOf([]) },
];

const aRepository = () => repository(51, A_ONLY, { enabled: true, document: claOf() });
const bRepository = () => repository(61, B_ONLY, { enabled: false, document: claOf({ id: 61, name: 'Globex CLA' }) });

/** The repositories of the two tenants by the installation in the path; the list of tenant B waits for `release()`. */
function serveTwoTenants(extra: Parameters<typeof serveRepositories>[0] = {}) {
  const gate = Promise.withResolvers<true>();
  const served = serveRepositories({
    tenants: TENANTS,
    byRequest: async ({ installationId }) => {
      if (installationId === 6) {
        await gate.promise;
        return pageOf([bRepository()]);
      }
      return pageOf([aRepository()]);
    },
    ...extra,
  });
  return {
    served,
    release: () => {
      gate.resolve(true);
    },
  };
}

const switchToGlobex = async (user: UserEvent) => {
  await user.click(await screen.findByRole('button', { name: /^Installation/ }));
  await user.click(
    within(screen.getByRole('navigation', { name: messages['tenant.switcher.label'] })).getByRole('link', {
      name: 'globex',
    }),
  );
};

test('switching from A to B shows no repository of A at any moment, B is loading until its answer arrives, and then only B is shown', async () => {
  const { release } = serveTwoTenants();
  const { user } = renderRepositories(REPOSITORIES_ROUTE);
  await screen.findByText(A_ONLY);
  await switchToGlobex(user);
  expect(await screen.findByText(messages['states.loading'])).toBeInTheDocument();
  expect(screen.queryByText(A_ONLY)).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
  expect(window.location.pathname).toBe('/installations/6/repositories');
  release();
  await screen.findByText(B_ONLY);
  expect(screen.queryByText(A_ONLY)).toBeNull();
  expect(rowsOf(repositoriesTable()).map((row) => row[0])).toEqual([B_ONLY]);
});

test("each list names the installation on screen in its path: A's list, then B's list, and back to A shows A's repositories and none of B's", async () => {
  const { served, release } = serveTwoTenants();
  release();
  const { user } = renderRepositories(REPOSITORIES_ROUTE);
  await screen.findByText(A_ONLY);
  await switchToGlobex(user);
  await screen.findByText(B_ONLY);
  await user.click(await screen.findByRole('button', { name: /^Installation/ }));
  await user.click(
    within(screen.getByRole('navigation', { name: messages['tenant.switcher.label'] })).getByRole('link', {
      name: 'acme',
    }),
  );
  await screen.findByText(A_ONLY);
  expect(screen.queryByText(B_ONLY)).toBeNull();
  expect(served.list.map(pathOf)).toContain('/api/installations/5/repositories');
  expect(served.list.map(pathOf)).toContain('/api/installations/6/repositories');
  expect(new Set(served.list.map(pathOf))).toEqual(
    new Set(['/api/installations/5/repositories', '/api/installations/6/repositories']),
  );
});

test("the actions of a row are addressed through the repository of the row and the installation on screen: B's repository, B's documents", async () => {
  const { served, release } = serveTwoTenants({
    byRequest: ({ installationId }) => pageOf([installationId === 6 ? bRepository() : aRepository()]),
    enable: [switchedTo(true)],
  });
  release();
  const { user } = renderRepositories(`/installations/6/repositories`);
  await screen.findByText(B_ONLY);
  await user.click(screen.getByRole('button', { name: /^Change CLA of/ }));
  await screen.findByRole('combobox', { name: messages['repositories.attach.field'] });
  expect(documentSelect()).toHaveValue('61');
  expect(served.documents.map(pathOf)).toEqual(['/api/installations/6/repositories/61/documents']);
  await user.keyboard('{Escape}');
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  await user.click(enableButton(B_ONLY));
  await waitFor(() => {
    expect(served.enable).toHaveLength(1);
  });
  expect(pathOf(served.enable[0])).toBe('/api/repositories/61/enable');
  await waitFor(() => {
    expect(served.list.map(pathOf)).toEqual(['/api/installations/6/repositories', '/api/installations/6/repositories']);
  });
});

test("a change in tenant A asks for A's list again and for no other tenant's", async () => {
  const { served, release } = serveTwoTenants({
    byRequest: ({ installationId }) =>
      pageOf([installationId === 6 ? bRepository() : gadgets({ id: 51, fullName: A_ONLY })]),
    enable: [switchedTo(true)],
  });
  release();
  const { user } = renderRepositories(REPOSITORIES_ROUTE);
  await screen.findByText(A_ONLY);
  await user.click(enableButton(A_ONLY));
  await waitFor(() => {
    expect(served.list).toHaveLength(2);
  });
  expect(served.list.map(pathOf)).toEqual(['/api/installations/5/repositories', '/api/installations/5/repositories']);
  expect(pathOf(served.enable[0])).toBe('/api/repositories/51/enable');
});

test('a tenant the server does not know is the error state with no data, and nothing of the tenant before it', async () => {
  serveTwoTenants({
    byRequest: ({ installationId }) => (installationId === 5 ? pageOf([aRepository()]) : notFound()),
  });
  const { user } = renderRepositories(REPOSITORIES_ROUTE);
  await screen.findByText(A_ONLY);
  await switchToGlobex(user);
  expect(await screen.findByRole('alert')).toHaveTextContent(messages['errors.not_found']);
  expect(screen.queryByText(A_ONLY)).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
});

test('an address with an installation that is not a plain number is no page of the app', async () => {
  serveTwoTenants();
  renderRepositories('/installations/5abc/repositories');
  expect(await heading(messages['states.notFound.title'])).toBeInTheDocument();
});
