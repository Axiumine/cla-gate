// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { http } from 'msw';
import { expect, test } from 'vitest';
import { OPERATOR_INSTALLATIONS_PATH } from '../../shared/operator.ts';
import { envelope } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { server } from '../test-support/server.ts';
import {
  installationOf,
  OPERATOR_ROUTE,
  operatorList,
  operatorTable,
  rejectedOf,
  renderOperator,
  rowsOf,
  serveOperator,
} from './test-support.ts';

// E18-S13: the operator's page: what the endpoint says about each installation of the instance, in words and in UTC, and nothing the
// endpoint does not carry.

const SUSPENDED = installationOf({
  githubInstallationId: 100003,
  accountId: 4002,
  accountLogin: 'globex',
  suspendedAt: '2026-10-05T12:00:00.000Z',
  tenantState: 'suspended',
  repositories: { active: 2, enabled: 0, removed: 0 },
});
const DELETED = installationOf({
  githubInstallationId: 100004,
  accountId: 4003,
  accountLogin: 'initech',
  accountType: 'Other',
  suspendedAt: '2026-10-05T12:00:00.000Z',
  deletedAt: '2026-10-06T08:15:00.000Z',
  tenantState: 'deleted',
  repositories: { active: 0, enabled: 0, removed: 4 },
});

test('the page has the one h1 "Operator installations", the table with its visible caption, and a row for each installation', async () => {
  serveOperator(operatorList([installationOf(), rejectedOf(), SUSPENDED, DELETED]));
  renderOperator();
  const table = await operatorTable();
  expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([messages['operator.title']]);
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent),
  ).toEqual([
    messages['operator.col.account'],
    messages['operator.col.type'],
    messages['operator.col.installation'],
    messages['operator.col.admission'],
    messages['operator.col.state'],
    messages['operator.col.times'],
    messages['operator.col.repositories'],
  ]);
  expect(table.querySelectorAll('tbody tr')).toHaveLength(4);
  expect(within(table).getByText(messages['operator.caption'])).not.toHaveClass('sr-only');
  expect(document.title).toBe(`${messages['operator.title']} · CLA`);
});

test('an admitted organisation: login, type, the GitHub installation id in code, admission, the active badge, the decision time and the counts', async () => {
  serveOperator(operatorList([installationOf()]));
  renderOperator();
  const table = await operatorTable();
  expect(rowsOf(table)).toEqual([
    [
      'acme',
      messages['installations.type.organization'],
      '100001',
      messages['operator.admission.admitted'],
      messages['status.active'],
      `${messages['operator.time.decided']}2026-10-01 09:00 UTC`,
      '12 active3 enforcing1 removed',
    ],
  ]);
  const row = within(table).getAllByRole('row')[1];
  expect(row?.querySelector('td:nth-child(3) code')?.textContent).toBe('100001');
  expect(row?.querySelector('[data-status]')).toHaveAttribute('data-status', 'active');
  expect(row?.querySelector('time')).toHaveAttribute('datetime', '2026-10-01T09:00:00.000Z');
});

test('a rejected row shows the stored reason as text, and as the stored code', async () => {
  serveOperator(
    operatorList([rejectedOf(), rejectedOf({ githubInstallationId: 100005, admissionReason: 'policy_changed' })]),
  );
  renderOperator();
  const table = await operatorTable();
  const [first, second] = [...table.querySelectorAll('tbody tr')];
  const admission = (row: Element | undefined) => row?.querySelector('td:nth-child(4)');
  expect(admission(first)?.textContent).toBe(
    `${messages['operator.admission.rejected']}${messages['operator.admission.reason.account_not_allowed']} account_not_allowed`,
  );
  expect(admission(first)?.querySelector('code')?.textContent).toBe('account_not_allowed');
  expect(admission(second)?.textContent).toBe(
    `${messages['operator.admission.rejected']}${messages['operator.admission.reason.policy_changed']} policy_changed`,
  );
  expect(first?.querySelector('[data-status]')).toHaveAttribute('data-status', 'rejected');
  expect(first?.querySelector('td:nth-child(6)')?.textContent).toBe(
    `${messages['operator.time.decided']}2026-10-02 10:30 UTC`,
  );
});

test('a rejected row with no stored reason says so, and shows no code', async () => {
  serveOperator(operatorList([rejectedOf({ admissionReason: null, admissionDecidedAt: null })]));
  renderOperator();
  const table = await operatorTable();
  const cells = rowsOf(table)[0];
  expect(cells?.[3]).toBe(`${messages['operator.admission.rejected']}${messages['operator.admission.reason.none']}`);
  expect(table.querySelector('td:nth-child(4) code')).toBeNull();
  expect(cells?.[5]).toBe(messages['operator.time.none']);
});

test('suspended and deleted installations show their badge and every time that exists, each named, in UTC', async () => {
  serveOperator(operatorList([SUSPENDED, DELETED]));
  renderOperator();
  const table = await operatorTable();
  const [suspended, deleted] = rowsOf(table);
  expect(suspended?.[4]).toBe(messages['status.suspended']);
  expect(suspended?.[5]).toBe(
    `${messages['operator.time.decided']}2026-10-01 09:00 UTC${messages['operator.time.suspended']}2026-10-05 12:00 UTC`,
  );
  expect(deleted?.[1]).toBe(messages['installations.type.other']);
  expect(deleted?.[4]).toBe(messages['status.deleted']);
  expect(deleted?.[5]).toBe(
    `${messages['operator.time.decided']}2026-10-01 09:00 UTC${messages['operator.time.suspended']}2026-10-05 12:00 UTC${messages['operator.time.deleted']}2026-10-06 08:15 UTC`,
  );
  expect(deleted?.[6]).toBe('0 active0 enforcing4 removed');
});

test.each([
  ['active', installationOf(), 'bg-success-bg'],
  ['rejected', rejectedOf(), 'bg-danger-bg'],
  ['suspended', SUSPENDED, 'bg-warning-bg'],
  ['deleted', DELETED, 'bg-surface-muted'],
] as const)(
  'the state %s is a badge with its word and its tint, so colour is never the only signal',
  async (state, row, tint) => {
    serveOperator(operatorList([row]));
    renderOperator();
    const badge = (await operatorTable()).querySelector('[data-status]');
    expect(row.tenantState).toBe(state);
    expect(badge).toHaveAttribute('data-status', state);
    expect(badge).toHaveTextContent(messages[`status.${state}`]);
    expect(badge).toHaveClass(tint);
  },
);

test('the page explains that admission is the instance configuration and is not changed here, and that operating opens no tenant', async () => {
  serveOperator(operatorList([installationOf()]));
  renderOperator();
  await operatorTable();
  const main = screen.getByRole('main');
  expect(within(main).getByText(messages['operator.admission.note'])).toBeInTheDocument();
  expect(messages['operator.admission.note']).toContain('GITHUB_ALLOWED_ACCOUNT_IDS');
  expect(messages['operator.admission.note']).toContain('docs/configuration.md');
  expect(within(main).getByText(messages['operator.access.note'])).toBeInTheDocument();
  expect(messages['operator.access.note']).toMatch(/no access to an organisation/);
  expect(within(main).getByText(messages['operator.intro'])).toBeInTheDocument();
});

test('an instance no account has installed the App on shows the empty state with its own heading, not an empty table', async () => {
  serveOperator(operatorList([]));
  renderOperator();
  expect(await screen.findByRole('heading', { level: 2, name: messages['operator.empty.title'] })).toBeInTheDocument();
  expect(screen.getByText(messages['operator.empty.description'])).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
});

test('the page is loading until the endpoint answers, and shows no heading of the operator page before that', async () => {
  const gate = Promise.withResolvers<true>();
  server.use(
    http.get(OPERATOR_INSTALLATIONS_PATH, async () => {
      await gate.promise;
      return operatorList([installationOf()]);
    }),
  );
  renderOperator();
  expect(await screen.findByText(messages['states.loading'])).toBeInTheDocument();
  expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  gate.resolve(true);
  expect(await operatorTable()).toBeInTheDocument();
  expect(screen.queryByText(messages['states.loading'])).toBeNull();
});

test('a failure of the endpoint is the error state with its retry, never an empty table, and the retry shows the list', async () => {
  serveOperator(envelope(502, 'github_unavailable'), operatorList([installationOf()]));
  const { user } = renderOperator();
  const alert = await screen.findByRole('alert');
  expect(within(alert).getByRole('heading', { level: 1, name: messages['states.error.title'] })).toBeInTheDocument();
  expect(alert).toHaveTextContent(messages['errors.github_unavailable']);
  expect(screen.queryByRole('table')).toBeNull();
  await user.click(within(alert).getByRole('button', { name: messages['states.retry'] }));
  expect(await operatorTable()).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('the page passes axe with every kind of row', async () => {
  serveOperator(operatorList([installationOf(), rejectedOf(), SUSPENDED, DELETED]));
  const { container } = renderOperator();
  await operatorTable();
  await expectNoA11yViolations(container);
});

test('the empty state and the error state pass axe', async () => {
  serveOperator(operatorList([]));
  const empty = renderOperator();
  await screen.findByRole('heading', { level: 2, name: messages['operator.empty.title'] });
  await expectNoA11yViolations(empty.container);
  empty.unmount();
  serveOperator(envelope(502, 'github_unavailable'));
  const failed = renderOperator(OPERATOR_ROUTE);
  await screen.findByRole('alert');
  await expectNoA11yViolations(failed.container);
});
