// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { envelope } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { summary, tenantOf } from '../installations/test-support.ts';
import { server } from '../test-support/server.ts';
import {
  AUDIT_ROUTE,
  actorField,
  eventOf,
  metadataButton,
  openAudit,
  pageOf,
  renderAudit,
  serveAudit,
  systemEventOf,
} from './test-support.ts';

// E18-S09: the log is append-only, and the screen has no control that could change it: the only buttons are the filter, the pager and
// the controls that expand a row's metadata, and nothing but GET leaves the browser.

afterEach(() => {
  server.events.removeAllListeners();
});

/** The accessible names of the buttons in the main landmark, in order. */
const buttonsOfPage = () =>
  within(screen.getByRole('main'))
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label') ?? button.textContent);

test('the only buttons are the filter button, the metadata controls and the pager', async () => {
  await openAudit(AUDIT_ROUTE, {
    log: [pageOf([eventOf({ id: 12 }), systemEventOf({ id: 11 }), eventOf({ id: 10 })], 'c2')],
  });
  expect(buttonsOfPage()).toEqual([
    messages['audit.filter.apply'],
    messages['audit.metadata.showLabel'].replace('{id}', '12'),
    messages['audit.metadata.showLabel'].replace('{id}', '10'),
    messages['pager.previous'],
    messages['pager.next'],
  ]);
});

test('with a filter applied the clear button joins them, and an opened row says Hide: still filter, expand and pager', async () => {
  const { user } = await openAudit(`${AUDIT_ROUTE}?actorGithubId=4711`, { log: [pageOf([eventOf({ id: 12 })], 'c2')] });
  await user.click(metadataButton(12));
  expect(buttonsOfPage()).toEqual([
    messages['audit.filter.apply'],
    messages['audit.filter.clear'],
    messages['audit.metadata.hideLabel'].replace('{id}', '12'),
    messages['pager.previous'],
    messages['pager.next'],
  ]);
});

test('the page has one form, the filter form, and no field that is not one of its filters', async () => {
  const { container } = await openAudit();
  const main = screen.getByRole('main');
  expect(main.querySelectorAll('form')).toHaveLength(1);
  const fields = [
    ...main.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea'),
  ];
  expect(fields.map((field) => field.tagName.toLowerCase() + field.type)).toEqual([
    'selectselect-one',
    'inputtext',
    'inputtext',
    'inputtext',
    'inputtext',
    'inputtext',
  ]);
  expect(container.querySelectorAll('[contenteditable], input[type=checkbox], input[type=file]')).toHaveLength(0);
});

test('the table has no link, and no row has an edit, delete or revoke control', async () => {
  await openAudit();
  const table = screen.getByRole('table', { name: messages['audit.caption'] });
  expect(within(table).queryAllByRole('link')).toEqual([]);
  expect(within(table).queryByRole('button', { name: /edit|delete|remove|revoke|erase|undo/i })).toBeNull();
});

test('using every control sends nothing but GET', async () => {
  const methods: string[] = [];
  server.events.on('request:start', ({ request }) => {
    methods.push(request.method);
  });
  const { user } = await openAudit(AUDIT_ROUTE, { log: [pageOf([eventOf({ id: 12 })], 'c2')] });
  await user.click(metadataButton(12));
  await user.type(actorField(), '4711{Enter}');
  await user.click(await screen.findByRole('button', { name: messages['audit.filter.clear'] }));
  await user.click(screen.getByRole('button', { name: messages['pager.next'] }));
  expect(methods.length).toBeGreaterThan(3);
  expect(new Set(methods)).toEqual(new Set(['GET']));
});

test('the navigation of the tenant has the audit log for an org admin, last, and marks it as the current page', async () => {
  await openAudit();
  const nav = screen.getByRole('navigation', { name: messages['tenant.nav.label'] });
  const link = within(nav).getByRole('link', { name: messages['tenant.nav.audit'] });
  expect(link).toHaveAttribute('href', '/installations/5/audit');
  expect(link).toHaveAttribute('aria-current', 'page');
  expect(within(nav).getAllByRole('link').at(-1)).toBe(link);
});

test('a repo admin has no audit link, and opening the address directly is the forbidden state the server answers', async () => {
  serveAudit({
    tenants: [tenantOf(summary({ role: 'repo_admin' }), 'acme/widgets')],
    log: [envelope(403, 'forbidden')],
  });
  renderAudit(AUDIT_ROUTE);
  expect(
    await screen.findByRole('heading', { level: 3, name: messages['states.forbidden.title'] }),
  ).toBeInTheDocument();
  const nav = screen.getByRole('navigation', { name: messages['tenant.nav.label'] });
  expect(within(nav).queryByRole('link', { name: messages['tenant.nav.audit'] })).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
});
