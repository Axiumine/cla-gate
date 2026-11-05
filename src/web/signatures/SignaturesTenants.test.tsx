// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { createElement } from 'react';
import { expect, test, vi } from 'vitest';
import { logoutRoute } from '../../shared/auth-contract.ts';
import { SIGNATURE_REVOKE_PATH } from '../../shared/signature-revoke.ts';
import { SIGNATURES_PATH } from '../../shared/signature-search.ts';
import { answer, type Seen } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { installationKey } from '../installations/installation-queries.ts';
import { summary, tenantOf } from '../installations/test-support.ts';
import { AppRouter } from '../router.tsx';
import { spyOnPageNavigation } from '../test-support/location.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { server } from '../test-support/server.ts';
import { signaturesKey } from './signature-queries.ts';
import {
  bodyOf,
  confirmButton,
  notFound,
  pageOf,
  pathOf,
  reasonSelect,
  renderSignatures,
  revokeButton,
  revokeDialog,
  revokedAs,
  revokedOf,
  rowsOf,
  SIGNATURES_ROUTE,
  serveSignatures,
  signatureOf,
  signaturesTable,
} from './test-support.ts';

// E18-S07: cross-tenant isolation in the browser. The server filters every query by tenant whatever the address says (E15); what the screen
// adds is that nothing of one tenant is drawn under another, not even while the other's answer is awaited, that every request is addressed
// through the installation on screen, and that nothing outlives the session.

/** Signers that only one of the two tenants holds, in a form no request id or message can contain (`zzzz` is not hexadecimal). */
const A_ONLY = 'zzzz-acme-only';
const B_ONLY = 'zzzz-globex-only';
const TENANTS = [
  tenantOf(summary(), 'acme/widgets'),
  tenantOf(summary({ id: 6, accountLogin: 'globex', role: 'org_admin' }), 'globex/api'),
];

const rowOf = (id: number, name: string, state: 'active' | 'revoked' = 'active') =>
  (state === 'active' ? signatureOf : revokedOf)({
    id,
    githubUserId: id,
    signer: { login: `${name}-login`, name, email: `${name}@example.org` },
  });

/** The signatures of the two tenants by the installation in the path; the list of tenant B waits for `release()`, and a revocation is kept. */
function serveTwoTenants() {
  const gate = Promise.withResolvers<true>();
  const seen: Seen[] = [];
  const revoked = new Set<number>();
  const served = serveSignatures({ tenants: TENANTS });
  server.use(
    http.get(SIGNATURES_PATH, async ({ request, params }) => {
      seen.push({ method: request.method, url: request.url, headers: {}, text: '' });
      if (params['installationId'] === '6') {
        await gate.promise;
        return pageOf([rowOf(6001, B_ONLY, revoked.has(6001) ? 'revoked' : 'active')]);
      }
      return pageOf([rowOf(5001, A_ONLY)]);
    }),
    http.post(SIGNATURE_REVOKE_PATH, async ({ request, params }) => {
      served.revoke.push({
        method: request.method,
        url: request.url,
        headers: {},
        text: await request.clone().text(),
      });
      const id = Number(params['signatureId']);
      revoked.add(id);
      return revokedAs(id);
    }),
  );
  return {
    seen,
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

test('switching from A to B shows no signer of A at any moment, B is loading until its answer arrives, and then only B is shown', async () => {
  const { release } = serveTwoTenants();
  const { user } = renderSignatures(SIGNATURES_ROUTE);
  await screen.findByText(A_ONLY);
  await switchToGlobex(user);
  expect(await screen.findByText(messages['states.loading'])).toBeInTheDocument();
  expect(screen.queryByText(A_ONLY)).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
  expect(window.location.pathname).toBe('/installations/6/signatures');
  release();
  await screen.findByText(B_ONLY);
  expect(screen.queryByText(A_ONLY)).toBeNull();
  expect(rowsOf(signaturesTable()).map((row) => row[0])).toEqual([`${B_ONLY}${B_ONLY}-login`]);
});

test("each search names the installation on screen in its path: A's list, then B's list", async () => {
  const { seen, release } = serveTwoTenants();
  release();
  const { user } = renderSignatures(SIGNATURES_ROUTE);
  await screen.findByText(A_ONLY);
  await switchToGlobex(user);
  await screen.findByText(B_ONLY);
  expect(seen.map(pathOf)).toEqual(['/api/installations/5/signatures', '/api/installations/6/signatures']);
});

test('the filters of A are not carried to B: the search, the status and the document leave the address, and B is asked with none', async () => {
  const { seen, release } = serveTwoTenants();
  release();
  const { user } = renderSignatures(`${SIGNATURES_ROUTE}?q=octocat&state=revoked&document=11&cursor=c2`);
  await screen.findByText(A_ONLY);
  await switchToGlobex(user);
  await screen.findByText(B_ONLY);
  expect(window.location.pathname).toBe('/installations/6/signatures');
  expect(window.location.search).toBe('');
  expect(new URL(String(seen[1]?.url)).search).toBe('?limit=50');
});

test('a revocation on B is addressed to B, with the ids of B in the path, and never to A', async () => {
  const { served, release } = serveTwoTenants();
  release();
  const { user } = renderSignatures(SIGNATURES_ROUTE);
  await screen.findByText(A_ONLY);
  await switchToGlobex(user);
  await screen.findByText(B_ONLY);
  await user.click(revokeButton(B_ONLY));
  await screen.findByRole('alertdialog');
  await user.selectOptions(reasonSelect(), 'legal_request');
  await user.click(confirmButton());
  await waitFor(() => {
    expect(served.revoke).toHaveLength(1);
  });
  expect(served.revoke.map((seen) => [pathOf(seen), bodyOf(seen)])).toEqual([
    ['/api/installations/6/signatures/6001/revoke', { reasonCode: 'legal_request' }],
  ]);
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  expect(rowsOf(signaturesTable())[0]?.[6]).toBe(messages['status.revoked']);
});

test('the id of a signature of another tenant is a 404: the not-found state in the question, and the request named the tenant on screen', async () => {
  const { release, served } = serveTwoTenants();
  release();
  server.use(
    http.get(SIGNATURES_PATH, () => pageOf([rowOf(6001, A_ONLY)])),
    http.post(SIGNATURE_REVOKE_PATH, ({ request, params }) => {
      served.revoke.push({ method: request.method, url: request.url, headers: {}, text: '' });
      return params['installationId'] === '5' && params['signatureId'] === '6001' ? notFound() : revokedAs(6001);
    }),
  );
  const { user } = renderSignatures(SIGNATURES_ROUTE);
  await screen.findByText(A_ONLY);
  await user.click(revokeButton(A_ONLY));
  await screen.findByRole('alertdialog');
  await user.selectOptions(reasonSelect(), 'other');
  await user.click(confirmButton());
  expect(await within(revokeDialog()).findByRole('alert')).toHaveTextContent(messages['errors.not_found']);
  expect(served.revoke.map(pathOf)).toEqual(['/api/installations/5/signatures/6001/revoke']);
  expect(screen.queryByText(messages['signatures.notice.revoked'])).toBeNull();
});

test('an installation the person cannot open is the not-found state and no row', async () => {
  serveSignatures({ tenants: TENANTS });
  server.use(http.get(SIGNATURES_PATH, () => notFound()));
  renderSignatures('/installations/777/signatures');
  expect(await screen.findByRole('alert')).toHaveTextContent(messages['errors.not_found']);
  expect(screen.queryByRole('table')).toBeNull();
});

test("every query of the signatures is kept under ['installation', its id, 'signatures'], and one tenant's are dropped without the other's", async () => {
  const { release } = serveTwoTenants();
  release();
  const { user, queryClient } = renderSignatures(SIGNATURES_ROUTE);
  await screen.findByText(A_ONLY);
  await switchToGlobex(user);
  await screen.findByText(B_ONLY);
  const keys = queryClient
    .getQueryCache()
    .getAll()
    .map((query) => query.queryKey)
    .filter((key) => key[2] === 'signatures');
  expect(keys.map((key) => key.slice(0, 3))).toEqual([signaturesKey(5), signaturesKey(6)]);
  expect(keys.every((key) => key[0] === installationKey(5)[0])).toBe(true);
  queryClient.removeQueries({ queryKey: signaturesKey(5) });
  expect(
    queryClient
      .getQueryCache()
      .getAll()
      .filter((query) => query.queryKey[2] === 'signatures')
      .map((query) => query.queryKey[1]),
  ).toEqual([6]);
});

test('logging out clears the cache: no signatures query, and none of the signers or their emails, is left', async () => {
  const { release } = serveTwoTenants();
  release();
  answer(logoutRoute.path, new HttpResponse(null, { status: 204 }));
  const { user, queryClient, setSession, container } = renderSignatures(SIGNATURES_ROUTE);
  await screen.findByText(A_ONLY);
  expect(queryClient.getQueryCache().findAll({ queryKey: signaturesKey(5) })).toHaveLength(1);
  setSession(undefined);
  await user.click(screen.getByRole('button', { name: messages['auth.logout'] }));
  await screen.findByRole('heading', { level: 1, name: messages['app.name'] });
  expect(queryClient.getQueryCache().findAll({ queryKey: ['installation'] })).toEqual([]);
  expect(screen.queryByText(A_ONLY)).toBeNull();
  expect(container.textContent).not.toContain('zzzz');
});

test('a visitor without a session who opens the signatures is sent to the login, and no signature of any tenant is asked for', async () => {
  window.history.replaceState(null, '', SIGNATURES_ROUTE);
  const assign = spyOnPageNavigation();
  const served = serveSignatures();
  renderWithProviders(createElement(AppRouter), { route: SIGNATURES_ROUTE });
  await vi.waitFor(() => {
    expect(assign).toHaveBeenCalledExactlyOnceWith('/api/auth/login?return_to=%2Finstallations%2F5%2Fsignatures');
  });
  expect([served.search, served.revoke, served.documents, served.csv, served.tenants.list]).toEqual([
    [],
    [],
    [],
    [],
    [],
  ]);
  expect(screen.queryByRole('table')).toBeNull();
});
