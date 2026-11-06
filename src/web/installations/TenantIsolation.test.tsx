// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { logoutRoute } from '../../shared/auth-contract.ts';
import { answer } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { INSTALLATIONS_KEY, installationKey } from './installation-queries.ts';
import {
  globex,
  heading,
  renderInstallations,
  repositoriesOf,
  repository,
  serveTenants,
  summary,
  tenantOf,
} from './test-support.ts';

// E18-S04: cross-tenant isolation in the browser. The server filters every query by installation id whatever the URL says (E11);
// what this screen adds is that nothing of one tenant is ever drawn under another, not even for the moment before the second
// tenant's answer is there, and that nothing outlives the session.

const ACME = summary();
const GLOBEX = globex();

/** A repository name that cannot be in a request id or a message: `zzzz` is not hexadecimal. */
const A_ONLY = 'zzzz-acme/only-in-a';
const B_ONLY = 'zzzz-globex/only-in-b';

const switchToGlobex = async (user: UserEvent) => {
  await user.click(await screen.findByRole('button', { name: /^Installation/ }));
  await user.click(
    within(screen.getByRole('navigation', { name: messages['tenant.switcher.label'] })).getByRole('link', {
      name: 'globex',
    }),
  );
};

test('switching from A to B shows no row of A at any moment, B is loading until its answer arrives, and then only B is shown', async () => {
  const held = Promise.withResolvers<true>();
  const release = () => {
    held.resolve(true);
  };
  serveTenants([
    tenantOf(ACME, A_ONLY),
    {
      summary: GLOBEX,
      answer: async () => {
        await held.promise;
        return repositoriesOf([repository(1, B_ONLY)]);
      },
    },
  ]);
  const { user } = renderInstallations('/installations/5');
  await screen.findByText(A_ONLY);
  await switchToGlobex(user);
  expect(await screen.findByText(messages['states.loading'])).toBeInTheDocument();
  expect(screen.queryByText(A_ONLY)).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByRole('heading', { level: 1, name: 'acme' })).toBeNull();
  release();
  expect(await screen.findByText(B_ONLY)).toBeInTheDocument();
  expect(screen.queryByText(A_ONLY)).toBeNull();
  expect(await heading('globex')).toBeInTheDocument();
});

test("the request for B names B in its path, and A's request named A", async () => {
  const served = serveTenants([tenantOf(ACME, A_ONLY), tenantOf(GLOBEX, B_ONLY)]);
  const { user } = renderInstallations('/installations/5');
  await screen.findByText(A_ONLY);
  await switchToGlobex(user);
  await screen.findByText(B_ONLY);
  expect(served.repositories.map((seen) => new URL(seen.url).pathname)).toEqual([
    '/api/installations/5/repositories',
    '/api/installations/6/repositories',
  ]);
});

test("every query of a tenant is kept under ['installation', its id]; the list of the person is under its own key", async () => {
  serveTenants([tenantOf(ACME, A_ONLY), tenantOf(GLOBEX, B_ONLY)]);
  const { user, queryClient } = renderInstallations('/installations/5');
  await screen.findByText(A_ONLY);
  await switchToGlobex(user);
  await screen.findByText(B_ONLY);
  const keys = queryClient
    .getQueryCache()
    .getAll()
    .map((query) => query.queryKey);
  const tenantKeys = keys.filter((key) => key[0] === 'installation');
  expect(tenantKeys.map((key) => key.slice(0, 2))).toEqual([installationKey(5), installationKey(6)]);
  expect(keys.filter((key) => key[0] === 'installations')).toEqual([INSTALLATIONS_KEY]);
  expect(
    keys
      .map((key) => key[0])
      .filter((first) => first !== 'installation' && first !== 'installations')
      .toSorted((a, b) => String(a).localeCompare(String(b))),
  ).toEqual(['auth', 'meta', 'operator']);
});

test('the data of A is gone from the cache of the tenant when the cache of A is dropped: it is one prefix', async () => {
  serveTenants([tenantOf(ACME, A_ONLY), tenantOf(GLOBEX, B_ONLY)]);
  const { user, queryClient } = renderInstallations('/installations/5');
  await screen.findByText(A_ONLY);
  await switchToGlobex(user);
  await screen.findByText(B_ONLY);
  queryClient.removeQueries({ queryKey: installationKey(5) });
  const left = queryClient
    .getQueryCache()
    .getAll()
    .filter((query) => query.queryKey[0] === 'installation')
    .map((query) => query.queryKey[1]);
  expect(left).toEqual([6]);
});

test('logging out clears the cache: no tenant query, and none of its names, is left', async () => {
  answer(logoutRoute.path, new Response(null, { status: 204 }));
  serveTenants([tenantOf(ACME, A_ONLY), tenantOf(GLOBEX, B_ONLY)]);
  const { user, queryClient, setSession } = renderInstallations('/installations/5');
  await screen.findByText(A_ONLY);
  expect(queryClient.getQueryCache().findAll({ queryKey: ['installation'] })).toHaveLength(1);
  setSession(undefined);
  await user.click(screen.getByRole('button', { name: messages['auth.logout'] }));
  await heading(messages['app.name']);
  expect(queryClient.getQueryCache().findAll({ queryKey: ['installation'] })).toEqual([]);
  expect(queryClient.getQueryCache().findAll({ queryKey: ['installations'] })).toEqual([]);
  expect(screen.queryByText(A_ONLY)).toBeNull();
});

test('an installation the person cannot open shows the state of the server and renders no data, also after another tenant was open', async () => {
  serveTenants([tenantOf(ACME, A_ONLY)]);
  renderInstallations('/installations/5');
  await screen.findByText(A_ONLY);
  window.history.pushState(null, '', '/installations/6');
  window.dispatchEvent(new PopStateEvent('popstate'));
  const state = await screen.findByRole('alert');
  expect(state).toHaveTextContent(messages['errors.not_found']);
  expect(screen.queryByText(A_ONLY)).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
});
