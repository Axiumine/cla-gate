// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { createElement } from 'react';
import { expect, test, vi } from 'vitest';
import {
  allowlistPageSchema,
  INSTALLATION_ALLOWLIST_PATH,
  REPOSITORY_ALLOWLIST_PATH,
  repositoryAllowlistPageSchema,
} from '../../shared/allowlist.ts';
import { logoutRoute } from '../../shared/auth-contract.ts';
import { answer, envelope, json, type Seen } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { installationKey } from '../installations/installation-queries.ts';
import { summary, tenantOf } from '../installations/test-support.ts';
import { AppRouter } from '../router.tsx';
import { spyOnPageNavigation } from '../test-support/location.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { server } from '../test-support/server.ts';
import { allowlistKey } from './allowlist-queries.ts';
import {
  ALLOWLIST_ROUTE,
  addButton,
  bodyOf,
  entriesTable,
  entryOf,
  kindRadio,
  loginField,
  pathOf,
  removeButton,
  renderAllowlist,
  rowsOf,
  serveAllowlist,
  storedAs,
  submitButton,
} from './test-support.ts';

// E18-S06: cross-tenant isolation in the browser. The server filters every query by tenant whatever the address says (E11); what the
// screen adds is that nothing of one tenant is drawn under another, not even while the other's answer is awaited, that every request is
// addressed through the installation or repository on screen, and that nothing outlives the session.

/** Entries and logins that only one of the two tenants holds, in a form no request id or message can contain (`zzzz` is not hexadecimal). */
const A_ONLY = 'zzzz-acme-only';
const B_ONLY = 'zzzz-globex-only';
const TENANTS = [
  tenantOf(summary(), 'acme/widgets', 'acme/gadgets'),
  tenantOf(summary({ id: 6, accountLogin: 'globex', role: 'org_admin' }), 'globex/api'),
];

/** The installation lists of the two tenants, by the installation in the path; the one of tenant B waits for `release()`. */
function serveTwoTenants() {
  const gate = Promise.withResolvers<true>();
  const seen: Seen[] = [];
  serveAllowlist({ tenants: TENANTS });
  server.use(
    http.get(INSTALLATION_ALLOWLIST_PATH, async ({ request, params }) => {
      seen.push({ method: request.method, url: request.url, headers: {}, text: '' });
      if (params['installationId'] === '6') {
        await gate.promise;
        return json(
          allowlistPageSchema.parse({
            entries: [entryOf({ id: 7, loginSnapshot: B_ONLY, githubId: 6007 })],
            nextCursor: null,
          }),
        );
      }
      return json(
        allowlistPageSchema.parse({
          entries: [entryOf({ id: 1, loginSnapshot: A_ONLY, githubId: 5001 })],
          nextCursor: null,
        }),
      );
    }),
  );
  return {
    seen,
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

test('switching from A to B shows no entry of A at any moment, B is loading until its answer arrives, and then only B is shown', async () => {
  const { release } = serveTwoTenants();
  const { user } = renderAllowlist('/installations/5/allowlist');
  await screen.findByText(A_ONLY);
  await switchToGlobex(user);
  expect(await screen.findByText(messages['states.loading'])).toBeInTheDocument();
  expect(screen.queryByText(A_ONLY)).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
  expect(window.location.pathname).toBe('/installations/6/allowlist');
  release();
  await screen.findByText(B_ONLY);
  expect(screen.queryByText(A_ONLY)).toBeNull();
  expect(rowsOf(entriesTable()).map((row) => row[1])).toEqual([`${B_ONLY} 6007`]);
});

test("each request names the installation on screen in its path: A's list, then B's list", async () => {
  const { seen, release } = serveTwoTenants();
  release();
  const { user } = renderAllowlist('/installations/5/allowlist');
  await screen.findByText(A_ONLY);
  await switchToGlobex(user);
  await screen.findByText(B_ONLY);
  expect(seen.map(pathOf)).toEqual([
    '/api/installations/5/allowlist-entries',
    '/api/installations/6/allowlist-entries',
  ]);
});

test('the scope of A is not carried to B: the repository is dropped from the address and B shows its whole installation', async () => {
  serveAllowlist({ tenants: TENANTS });
  const { user } = renderAllowlist('/installations/5/allowlist?repository=1');
  await screen.findByRole('heading', { level: 2, name: messages['allowlist.inherited.title'] });
  await switchToGlobex(user);
  await waitFor(() => {
    expect(window.location.pathname).toBe('/installations/6/allowlist');
  });
  expect(window.location.search).toBe('');
  await screen.findByRole('heading', { level: 2, name: messages['allowlist.entries.title'] });
  expect(screen.queryByRole('heading', { name: messages['allowlist.inherited.title'] })).toBeNull();
});

test('an add and a removal on B are addressed to B, with the id of B in the path', async () => {
  const { release } = serveTwoTenants();
  release();
  const served = serveAllowlist({ tenants: TENANTS, add: [storedAs({ id: 91 })] });
  server.use(
    http.get(INSTALLATION_ALLOWLIST_PATH, ({ params }) =>
      json(
        allowlistPageSchema.parse({
          entries: [
            entryOf({ id: 7, loginSnapshot: params['installationId'] === '6' ? B_ONLY : A_ONLY, githubId: 6007 }),
          ],
          nextCursor: null,
        }),
      ),
    ),
  );
  const { user } = renderAllowlist('/installations/6/allowlist');
  await screen.findByText(B_ONLY);
  await user.click(addButton());
  await user.click(loginField());
  await user.paste('someone');
  await user.click(submitButton());
  await waitFor(() => {
    expect(served.addInstallation).toHaveLength(1);
  });
  await user.click(removeButton(B_ONLY));
  await user.click(await screen.findByRole('button', { name: messages['allowlist.remove.confirm'] }));
  await waitFor(() => {
    expect(served.remove).toHaveLength(1);
  });
  expect(served.addInstallation.map((seen) => [pathOf(seen), bodyOf(seen)])).toEqual([
    ['/api/installations/6/allowlist-entries', { kind: 'user', login: 'someone' }],
  ]);
  expect(served.remove.map(pathOf)).toEqual(['/api/installations/6/allowlist-entries/7']);
});

test('an add to a repository is addressed to that repository, which the server resolves to its tenant', async () => {
  const served = serveAllowlist({ add: [storedAs()] });
  const { user } = renderAllowlist('/installations/5/allowlist?repository=2');
  await screen.findByRole('heading', { level: 2, name: messages['allowlist.entries.title'] });
  await user.click(addButton());
  await user.click(kindRadio(messages['allowlist.kind.bot']));
  await user.click(loginField());
  await user.paste('some-bot[bot]');
  await user.click(submitButton());
  await waitFor(() => {
    expect(served.addRepository).toHaveLength(1);
  });
  expect(served.addRepository.map((seen) => [pathOf(seen), bodyOf(seen)])).toEqual([
    ['/api/repositories/2/allowlist-entries', { kind: 'bot', login: 'some-bot[bot]' }],
  ]);
  expect(served.addInstallation).toEqual([]);
});

test("a repository of another tenant is the server's uniform 404: the not-found state and no entry, with no data of either tenant", async () => {
  serveAllowlist({ tenants: TENANTS });
  server.use(http.get(REPOSITORY_ALLOWLIST_PATH, () => envelope(404, 'not_found')));
  renderAllowlist('/installations/5/allowlist?repository=999');
  const state = await screen.findByRole('alert');
  expect(state).toHaveTextContent(messages['errors.not_found']);
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByRole('button', { name: messages['allowlist.add'] })).toBeNull();
  expect(screen.queryByText(A_ONLY)).toBeNull();
});

test('a repository of another tenant that the person also administers is not drawn under this tenant: the check through this installation says 404, and that allowlist is never asked for', async () => {
  const served = serveAllowlist({ tenants: TENANTS, membership: [envelope(404, 'not_found')] });
  renderAllowlist('/installations/5/allowlist?repository=99');
  const state = await screen.findByRole('alert');
  expect(state).toHaveTextContent(messages['errors.not_found']);
  expect(served.membership.map(pathOf)).toEqual(['/api/installations/5/repositories/99/documents']);
  expect(served.repositoryList).toEqual([]);
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByRole('button', { name: messages['allowlist.add'] })).toBeNull();
});

test('the id of an entry of another tenant is a 404: nothing of that tenant is shown, the answer says it was not found, and the list is asked for again', async () => {
  const { release } = serveTwoTenants();
  release();
  const served = serveAllowlist({ tenants: TENANTS, remove: [envelope(404, 'not_found')] });
  server.use(
    http.get(INSTALLATION_ALLOWLIST_PATH, () =>
      json(allowlistPageSchema.parse({ entries: [entryOf({ id: 42, loginSnapshot: A_ONLY })], nextCursor: null })),
    ),
  );
  const { user } = renderAllowlist('/installations/5/allowlist');
  await screen.findByText(A_ONLY);
  await user.click(removeButton(A_ONLY));
  await user.click(await screen.findByRole('button', { name: messages['allowlist.remove.confirm'] }));
  expect(await screen.findByText(messages['allowlist.notice.gone'])).toBeInTheDocument();
  expect(served.remove.map(pathOf)).toEqual(['/api/installations/5/allowlist-entries/42']);
  expect(screen.queryByRole('alert')).toBeNull();
});

test("every query of the allowlist is kept under ['installation', its id, 'allowlist'], the repository scope too", async () => {
  const { release } = serveTwoTenants();
  release();
  server.use(
    http.get(REPOSITORY_ALLOWLIST_PATH, () =>
      json(repositoryAllowlistPageSchema.parse({ own: [], inherited: [], nextCursor: null })),
    ),
  );
  const { user, queryClient } = renderAllowlist('/installations/5/allowlist');
  await screen.findByText(A_ONLY);
  await user.selectOptions(await screen.findByRole('combobox', { name: messages['allowlist.scope'] }), 'acme/gadgets');
  await screen.findByRole('heading', { level: 3, name: messages['allowlist.empty.title'] });
  await switchToGlobex(user);
  await screen.findByText(B_ONLY);
  const keys = queryClient
    .getQueryCache()
    .getAll()
    .map((query) => query.queryKey)
    .filter((key) => key[2] === 'allowlist');
  expect(keys.map((key) => key.slice(0, 4))).toEqual([
    [...allowlistKey(5), 'installation'],
    [...allowlistKey(5), 2],
    [...allowlistKey(6), 'installation'],
  ]);
  expect(keys.every((key) => key[0] === installationKey(5)[0])).toBe(true);
  queryClient.removeQueries({ queryKey: allowlistKey(5) });
  expect(
    queryClient
      .getQueryCache()
      .getAll()
      .filter((query) => query.queryKey[2] === 'allowlist')
      .map((query) => query.queryKey[1]),
  ).toEqual([6]);
});

test('logging out clears the cache: no allowlist query, and none of its logins, is left', async () => {
  const { release } = serveTwoTenants();
  release();
  answer(logoutRoute.path, new HttpResponse(null, { status: 204 }));
  const { user, queryClient, setSession } = renderAllowlist('/installations/5/allowlist');
  await screen.findByText(A_ONLY);
  expect(queryClient.getQueryCache().findAll({ queryKey: ['installation', 5, 'allowlist'] })).toHaveLength(1);
  setSession(undefined);
  await user.click(screen.getByRole('button', { name: messages['auth.logout'] }));
  await screen.findByRole('heading', { level: 1, name: messages['app.name'] });
  expect(queryClient.getQueryCache().findAll({ queryKey: ['installation'] })).toEqual([]);
  expect(screen.queryByText(A_ONLY)).toBeNull();
});

test('a visitor without a session who opens the allowlist is sent to the login, and no entry of any tenant is asked for', async () => {
  window.history.replaceState(null, '', ALLOWLIST_ROUTE);
  const assign = spyOnPageNavigation();
  const served = serveAllowlist();
  renderWithProviders(createElement(AppRouter), { route: ALLOWLIST_ROUTE });
  await vi.waitFor(() => {
    expect(assign).toHaveBeenCalledExactlyOnceWith('/api/auth/login?return_to=%2Finstallations%2F5%2Fallowlist');
  });
  expect([served.installationList, served.repositoryList, served.tenants.list, served.tenants.repositories]).toEqual([
    [],
    [],
    [],
    [],
  ]);
  expect(screen.queryByRole('table')).toBeNull();
});
