// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { logoutRoute } from '../../shared/auth-contract.ts';
import { answer } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { installationKey } from '../installations/installation-queries.ts';
import { heading, repositoriesOf, repository, summary, type Tenant, tenantOf } from '../installations/test-support.ts';
import { auditKey } from './audit-queries.ts';
import { AUDIT_ROUTE, actorField, eventOf, notFound, pageOf, pathOf, renderAudit, serveAudit } from './test-support.ts';

// E18-S09: cross-tenant isolation in the browser. The server filters every query by tenant whatever the address says (E16); what the
// screen adds is that nothing of one tenant is drawn under another, not even while the other's answer is awaited, that every request
// is addressed through the installation on screen, and that nothing outlives the session.

/** Logins that only one of the two tenants holds, in a form no request id or message can contain (`zzzz` is not hexadecimal). */
const A_ONLY = 'zzzz-only-in-a';
const B_ONLY = 'zzzz-only-in-b';
const ACME = tenantOf(summary(), 'acme/widgets');
const GLOBEX: Tenant = {
  summary: summary({ id: 6, accountLogin: 'globex' }),
  answer: () => repositoriesOf([repository(11, 'globex/api')]),
};

/** An event whose actor is `login`. */
const eventBy = (login: string) => eventOf({ actor: { githubId: 4711, login } });

const switchToGlobex = async (user: UserEvent) => {
  await user.click(await screen.findByRole('button', { name: /^Installation/ }));
  await user.click(
    within(screen.getByRole('navigation', { name: messages['tenant.switcher.label'] })).getByRole('link', {
      name: 'globex',
    }),
  );
};

test('the request carries the installation of the address in its path', async () => {
  const served = serveAudit({ tenants: [ACME, GLOBEX] });
  renderAudit('/installations/6/audit');
  await screen.findByRole('table', { name: messages['audit.caption'] });
  expect(served.log.map(pathOf)).toEqual(['/api/installations/6/audit-log']);
});

test('an installation id in the search is not a way to another tenant: the path is the address and the search never names a tenant', async () => {
  const served = serveAudit({ tenants: [ACME, GLOBEX] });
  renderAudit('/installations/5/audit?installationId=6&subjectType=installation&subjectId=6');
  await screen.findByRole('table', { name: messages['audit.caption'] });
  expect(served.log.map(pathOf)).toEqual(['/api/installations/5/audit-log']);
  expect(new URL(String(served.log[0]?.url)).searchParams.has('installationId')).toBe(false);
});

test('switching from A to B shows no event of A at any moment, B is loading until its answer arrives, and then only B is shown', async () => {
  const gate = Promise.withResolvers<true>();
  const served = serveAudit({
    tenants: [ACME, GLOBEX],
    log: [
      pageOf([eventBy(A_ONLY)]),
      async () => {
        await gate.promise;
        return pageOf([eventBy(B_ONLY)]);
      },
    ],
  });
  const { user } = renderAudit('/installations/5/audit');
  await screen.findByText(A_ONLY);
  await switchToGlobex(user);
  expect(await screen.findByText(messages['states.loading'])).toBeInTheDocument();
  expect(screen.queryByText(A_ONLY)).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
  gate.resolve(true);
  expect(await screen.findByText(B_ONLY)).toBeInTheDocument();
  expect(screen.queryByText(A_ONLY)).toBeNull();
  expect(window.location.pathname).toBe('/installations/6/audit');
  expect(served.log.map(pathOf)).toEqual(['/api/installations/5/audit-log', '/api/installations/6/audit-log']);
});

test('the filters of one tenant are not carried to another: the filtered address of A is the whole log of B', async () => {
  const served = serveAudit({ tenants: [ACME, GLOBEX], log: [pageOf([eventBy(A_ONLY)]), pageOf([eventBy(B_ONLY)])] });
  const { user } = renderAudit('/installations/5/audit?actorGithubId=4711');
  await screen.findByText(A_ONLY);
  await switchToGlobex(user);
  await screen.findByText(B_ONLY);
  expect(new URL(String(served.log[1]?.url)).search).toBe('?limit=50');
  expect(actorField()).toHaveValue('');
});

test('switching to a tenant where the person is a repo admin leaves the audit log for the start of that tenant, which has none', async () => {
  const repoAdmin: Tenant = { ...GLOBEX, summary: summary({ id: 6, accountLogin: 'globex', role: 'repo_admin' }) };
  const served = serveAudit({ tenants: [ACME, repoAdmin] });
  const { user } = renderAudit('/installations/5/audit');
  await screen.findByRole('table', { name: messages['audit.caption'] });
  await switchToGlobex(user);
  await heading('globex');
  expect(window.location.pathname).toBe('/installations/6');
  expect(screen.queryByRole('table', { name: messages['audit.caption'] })).toBeNull();
  expect(served.log).toHaveLength(1);
});

test('the uniform 404 for a tenant that is not the persons shows no row and no trace of the other tenant', async () => {
  serveAudit({ tenants: [ACME], log: [notFound()] });
  renderAudit('/installations/99/audit');
  expect(await screen.findByText(messages['errors.not_found'])).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByText('globex')).toBeNull();
});

test("the pages of the log are kept under ['installation', its id, 'audit'], and nothing is kept under the other tenant", async () => {
  serveAudit({ tenants: [ACME, GLOBEX], log: [pageOf([eventBy(A_ONLY)])] });
  const { queryClient } = renderAudit('/installations/5/audit');
  await screen.findByText(A_ONLY);
  expect(queryClient.getQueryCache().findAll({ queryKey: auditKey(5) })).toHaveLength(1);
  expect(queryClient.getQueryCache().findAll({ queryKey: auditKey(6) })).toEqual([]);
});

test('logging out clears the cache: no tenant query, and none of its events, is left', async () => {
  answer(logoutRoute.path, new Response(null, { status: 204 }));
  serveAudit({ tenants: [ACME, GLOBEX], log: [pageOf([eventBy(A_ONLY)])] });
  const { user, queryClient, setSession } = renderAudit(AUDIT_ROUTE);
  await screen.findByText(A_ONLY);
  expect(queryClient.getQueryCache().findAll({ queryKey: installationKey(5) }).length).toBeGreaterThan(0);
  setSession(undefined);
  await user.click(screen.getByRole('button', { name: messages['auth.logout'] }));
  await heading(messages['app.name']);
  expect(queryClient.getQueryCache().findAll({ queryKey: ['installation'] })).toEqual([]);
  expect(screen.queryByText(A_ONLY)).toBeNull();
});
