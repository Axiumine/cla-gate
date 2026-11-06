// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { createElement } from 'react';
import { expect, test, vi } from 'vitest';
import { logoutRoute } from '../../shared/auth-contract.ts';
import { COMMIT_OVERRIDE_PATH, COMMIT_OVERRIDES_PATH } from '../../shared/commit-override.ts';
import { PENDING_PRS_PATH } from '../../shared/pending-prs.ts';
import { answer, type Seen } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { installationKey } from '../installations/installation-queries.ts';
import { repositoriesOf, repository, summary, type Tenant } from '../installations/test-support.ts';
import { AppRouter } from '../router.tsx';
import { spyOnPageNavigation } from '../test-support/location.ts';
import { logOutAndExpectNoTrace } from '../test-support/log-out.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { server } from '../test-support/server.ts';
import { overridesKey, pendingKey } from './pending-queries.ts';
import {
  bodyOf,
  notFound,
  OVERRIDES_ROUTE,
  overrideOf,
  overridesPage,
  overridesTable,
  PENDING_ROUTE,
  pageOf,
  paramsOf,
  pathOf,
  pendingOf,
  pendingTable,
  reasonField,
  recordButton,
  recordedAs,
  renderPending,
  rowsOf,
  servePending,
  submitButton,
  unlinked,
} from './test-support.ts';

// E18-S08: cross-tenant isolation in the browser. The server filters every query by tenant whatever the address says (E15); what the screen
// adds is that nothing of one tenant is drawn under another, not even while the other's answer is awaited, that every request is
// addressed through the installation on screen or through one of its own repositories, and that nothing outlives the session.

/** Repositories and commits that only one of the two tenants holds, in a form no request id or message can contain (`zzzz` is not hexadecimal). */
const A_ONLY = 'zzzz-acme/only';
const B_ONLY = 'zzzz-globex/only';
const A_SHA = 'a'.repeat(40);
const B_SHA = 'b'.repeat(40);
const TENANTS: readonly Tenant[] = [
  { summary: summary(), answer: () => repositoriesOf([repository(1, A_ONLY)]) },
  {
    summary: summary({ id: 6, accountLogin: 'globex', role: 'org_admin' }),
    answer: () => repositoriesOf([repository(11, B_ONLY)]),
  },
];

const prOf = (repositoryId: number, fullName: string, sha: string) =>
  pendingOf({
    evaluationId: repositoryId,
    repository: { id: repositoryId, fullName },
    reasons: [unlinked(sha)],
  });

/** The pending lists and the overrides of the two tenants; the pending list of tenant B waits for `release()`. */
function serveTwoTenants() {
  const gate = Promise.withResolvers<true>();
  const seen: Seen[] = [];
  const served = servePending({ tenants: TENANTS });
  server.use(
    http.get(PENDING_PRS_PATH, async ({ request, params }) => {
      seen.push({ method: request.method, url: request.url, headers: {}, text: '' });
      if (params['installationId'] === '6') {
        await gate.promise;
        return pageOf([prOf(11, B_ONLY, B_SHA)]);
      }
      return pageOf([prOf(1, A_ONLY, A_SHA)]);
    }),
    http.get(COMMIT_OVERRIDES_PATH, ({ request, params }) => {
      served.overrides.push({ method: request.method, url: request.url, headers: {}, text: '' });
      return params['repositoryId'] === '11'
        ? overridesPage([overrideOf({ id: 2, commitSha: B_SHA, reason: 'zzzz-globex-reason' })])
        : overridesPage([overrideOf({ id: 1, commitSha: A_SHA, reason: 'zzzz-acme-reason' })]);
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

const repositories = () => rowsOf(pendingTable()).map((cells) => cells[0]);

/** Waits for the pending table to hold a row of the repository called `name`: the name is also a choice of the filter, which is not the row. */
const tableHas = async (name: string) => {
  await within(await screen.findByRole('table', { name: messages['pending.caption'] })).findByText(name);
};

test('switching from A to B shows no pull request of A at any moment, B is loading until its answer arrives, and then only B is shown', async () => {
  const { release } = serveTwoTenants();
  const { user } = renderPending(PENDING_ROUTE);
  await tableHas(A_ONLY);
  await switchToGlobex(user);
  expect(await screen.findByText(messages['states.loading'])).toBeInTheDocument();
  expect(screen.queryByText(A_ONLY)).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
  expect(window.location.pathname).toBe('/installations/6/pending');
  release();
  await tableHas(B_ONLY);
  expect(screen.queryByText(A_ONLY)).toBeNull();
  expect(repositories()).toEqual([B_ONLY]);
});

test("each list names the installation on screen in its path: A's list, then B's list", async () => {
  const { seen, release } = serveTwoTenants();
  release();
  const { user } = renderPending(PENDING_ROUTE);
  await tableHas(A_ONLY);
  await switchToGlobex(user);
  await tableHas(B_ONLY);
  expect(seen.map(pathOf)).toEqual(['/api/installations/5/pending-prs', '/api/installations/6/pending-prs']);
});

test('the filters and the cursor of A are not carried to B: they leave the address, and B is asked with none', async () => {
  const { seen, release } = serveTwoTenants();
  release();
  const { user } = renderPending(`${PENDING_ROUTE}?repository=1&reason=unlinked_identity&cursor=c2`);
  await tableHas(A_ONLY);
  await switchToGlobex(user);
  await tableHas(B_ONLY);
  expect(window.location.search).toBe('');
  expect(paramsOf(seen[1])).toEqual({ limit: '50' });
});

test('an override recorded for a pull request of B is addressed to the repository of B, and never to the one of A', async () => {
  const { served, release } = serveTwoTenants();
  release();
  server.use(
    http.post(COMMIT_OVERRIDES_PATH, async ({ request }) => {
      served.record.push({ method: request.method, url: request.url, headers: {}, text: await request.clone().text() });
      return recordedAs(2, B_SHA);
    }),
  );
  const { user } = renderPending(PENDING_ROUTE);
  await tableHas(A_ONLY);
  await switchToGlobex(user);
  await tableHas(B_ONLY);
  await user.click(recordButton('bbbbbbb', B_ONLY));
  await screen.findByRole('dialog');
  await user.type(reasonField(), 'Bot email');
  await user.click(submitButton());
  await waitFor(() => {
    expect(served.record).toHaveLength(1);
  });
  expect(served.record.map((seen) => [pathOf(seen), bodyOf(seen)])).toEqual([
    ['/api/repositories/11/commit-overrides', { commitSha: B_SHA, reason: 'Bot email' }],
  ]);
});

test('a repository of the other tenant in the address of the overrides is not shown and not asked for: the choice stays open', async () => {
  const { served, release } = serveTwoTenants();
  release();
  renderPending(`/installations/6/pending?tab=overrides&repository=1`);
  expect(
    await screen.findByRole('heading', { level: 2, name: messages['pending.overrides.choose.title'] }),
  ).toBeInTheDocument();
  expect(served.overrides).toEqual([]);
  expect(screen.queryByText('zzzz-acme-reason')).toBeNull();
});

test("switching on the overrides tab leaves the tab and the repository of A behind: no override of A is shown under B, and B's own repository shows only B's overrides", async () => {
  const { served, release } = serveTwoTenants();
  release();
  const { user } = renderPending(`${OVERRIDES_ROUTE}&repository=1`);
  await screen.findByText('zzzz-acme-reason');
  await switchToGlobex(user);
  await tableHas(B_ONLY);
  expect(window.location.pathname).toBe('/installations/6/pending');
  expect(window.location.search).toBe('');
  expect(screen.queryByText('zzzz-acme-reason')).toBeNull();
  await user.click(screen.getByRole('tab', { name: messages['pending.tab.overrides'] }));
  expect(
    await screen.findByRole('heading', { level: 2, name: messages['pending.overrides.choose.title'] }),
  ).toBeInTheDocument();
  await user.selectOptions(await screen.findByRole('combobox', { name: /^Repository/ }), B_ONLY);
  await screen.findByText('zzzz-globex-reason');
  expect(screen.queryByText('zzzz-acme-reason')).toBeNull();
  expect(rowsOf(overridesTable())[0]?.[0]).toBe(B_SHA);
  expect(served.overrides.map(pathOf)).toEqual([
    '/api/repositories/1/commit-overrides',
    '/api/repositories/11/commit-overrides',
  ]);
});

test('the id of an override of another tenant is a 404: the removal says it is gone and shows nothing of it, and the request named the repository on screen', async () => {
  const { served, release } = serveTwoTenants();
  release();
  server.use(
    http.delete(COMMIT_OVERRIDE_PATH, ({ request }) => {
      served.remove.push({ method: request.method, url: request.url, headers: {}, text: '' });
      return notFound();
    }),
  );
  const { user } = renderPending(`${OVERRIDES_ROUTE}&repository=1`);
  await screen.findByText('zzzz-acme-reason');
  await user.click(screen.getByRole('button', { name: /^Remove the override/ }));
  await user.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: messages['pending.overrides.remove.confirm'],
    }),
  );
  expect(await screen.findByText(messages['pending.overrides.notice.gone'])).toBeInTheDocument();
  expect(served.remove.map(pathOf)).toEqual(['/api/repositories/1/commit-overrides/1']);
});

test('an installation the person cannot open is the not-found state and no row', async () => {
  servePending({ tenants: TENANTS });
  server.use(http.get(PENDING_PRS_PATH, () => notFound()));
  renderPending('/installations/777/pending');
  expect(await screen.findByRole('alert')).toHaveTextContent(messages['errors.not_found']);
  expect(screen.queryByRole('table')).toBeNull();
});

test("every query of the screen is kept under ['installation', its id, ...], and one tenant's are dropped without the other's", async () => {
  const { release } = serveTwoTenants();
  release();
  const { user, queryClient } = renderPending(OVERRIDES_ROUTE);
  await screen.findByRole('option', { name: A_ONLY });
  await user.selectOptions(screen.getByRole('combobox', { name: /^Repository/ }), A_ONLY);
  await screen.findByText('zzzz-acme-reason');
  await user.click(screen.getByRole('tab', { name: messages['pending.tab.pending'] }));
  await tableHas(A_ONLY);
  await switchToGlobex(user);
  await tableHas(B_ONLY);
  const keys = queryClient
    .getQueryCache()
    .getAll()
    .map((query) => query.queryKey)
    .filter((key) => key[2] === 'pending' || key[2] === 'overrides');
  expect(keys.map((key) => key.slice(0, 3))).toEqual([overridesKey(5), pendingKey(5), pendingKey(6)]);
  expect(keys.every((key) => key[0] === installationKey(5)[0])).toBe(true);
  queryClient.removeQueries({ queryKey: pendingKey(5) });
  queryClient.removeQueries({ queryKey: overridesKey(5) });
  expect(
    queryClient
      .getQueryCache()
      .getAll()
      .filter((query) => query.queryKey[2] === 'pending' || query.queryKey[2] === 'overrides')
      .map((query) => query.queryKey[1]),
  ).toEqual([6]);
});

test('logging out clears the cache: no pending query, and none of the repositories or commits, is left', async () => {
  const { release } = serveTwoTenants();
  release();
  answer(logoutRoute.path, new HttpResponse(null, { status: 204 }));
  const app = renderPending(PENDING_ROUTE);
  await tableHas(A_ONLY);
  expect(app.queryClient.getQueryCache().findAll({ queryKey: pendingKey(5) })).toHaveLength(1);
  await logOutAndExpectNoTrace(app, A_ONLY);
  expect(app.container.textContent).not.toContain('zzzz');
});

test('a visitor without a session who opens the screen is sent to the login, and nothing of any tenant is asked for', async () => {
  window.history.replaceState(null, '', PENDING_ROUTE);
  const assign = spyOnPageNavigation();
  const served = servePending();
  renderWithProviders(createElement(AppRouter), { route: PENDING_ROUTE });
  await vi.waitFor(() => {
    expect(assign).toHaveBeenCalledExactlyOnceWith('/api/auth/login?return_to=%2Finstallations%2F5%2Fpending');
  });
  expect([served.pending, served.overrides, served.record, served.remove, served.tenants.list]).toEqual([
    [],
    [],
    [],
    [],
    [],
  ]);
  expect(screen.queryByRole('table')).toBeNull();
});
