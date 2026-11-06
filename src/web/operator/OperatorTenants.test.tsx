// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { json } from '../api/test-support.ts';
import { AUDIT_ROUTE, notFound, renderAudit, serveAudit } from '../audit/test-support.ts';
import { messages } from '../i18n/index.ts';
import { renderInstallations, serveTenants, summary, tenantOf } from '../installations/test-support.ts';
import { server } from '../test-support/server.ts';
import {
  installationOf,
  operatorLink,
  operatorList,
  rejectedOf,
  renderOperator,
  serveOperator,
} from './test-support.ts';

// E18-S13: the operator role is not a tenant role. An operator who is not an admin of a tenant gets the uniform not-found state from that
// tenant's routes, whatever the operator list says of it, and the operator page shows no tenant data and asks for none.

afterEach(() => {
  server.events.removeAllListeners();
});

/** A marker that a request id (hexadecimal) cannot hold. */
const ONLY_IN_TENANT = 'zzzz-tenant-only';

test('an operator who administers nothing gets the uniform not-found state from a tenant the instance serves, and no tenant data', async () => {
  serveOperator(operatorList([installationOf(), rejectedOf()]));
  serveTenants([], () => json([]));
  renderInstallations('/installations/5');
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(messages['errors.not_found']);
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByText('acme')).toBeNull();
  expect(await operatorLink()).toBeInTheDocument();
});

test('the screens of a tenant answer the operator with the same not-found state, here the audit log', async () => {
  serveOperator(operatorList([installationOf()]));
  serveAudit({ tenants: [], listing: () => json([]), log: [notFound()] });
  renderAudit(AUDIT_ROUTE);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(messages['errors.not_found']);
  expect(screen.queryByRole('table')).toBeNull();
});

test('the operator list does not make the person an admin of the installations in it: the list of their installations stays empty', async () => {
  serveOperator(operatorList([installationOf(), rejectedOf()]));
  serveTenants([], () => json([]));
  renderInstallations('/installations');
  expect(
    await screen.findByRole('heading', { level: 2, name: messages['installations.empty.title'] }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByText('acme')).toBeNull();
  expect(screen.queryByText('stranger')).toBeNull();
});

test('the operator page shows no tenant data and asks for none: no request names an installation, and no repository appears', async () => {
  const paths: string[] = [];
  server.events.on('request:start', ({ request }) => {
    paths.push(new URL(request.url).pathname);
  });
  serveOperator(operatorList([installationOf(), rejectedOf()]));
  serveTenants([tenantOf(summary(), ONLY_IN_TENANT)]);
  renderOperator();
  await screen.findByRole('table', { name: messages['operator.caption'] });
  expect(paths).toContain('/api/operator/installations');
  expect(paths.filter((path) => path.startsWith('/api/installations'))).toEqual([]);
  expect(screen.getByRole('main')).not.toHaveTextContent(ONLY_IN_TENANT);
});
