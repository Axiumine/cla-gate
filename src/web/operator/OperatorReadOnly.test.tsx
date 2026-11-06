// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { messages } from '../i18n/index.ts';
import { server } from '../test-support/server.ts';
import {
  installationOf,
  operatorList,
  operatorTable,
  rejectedOf,
  renderOperator,
  serveOperator,
} from './test-support.ts';

// E18-S13: the page is read-only. It has no control that changes anything, a row opens no tenant, and nothing but GET leaves the browser.

afterEach(() => {
  server.events.removeAllListeners();
});

test('the page has no button, no form field and no link in the table: there is nothing to press', async () => {
  serveOperator(operatorList([installationOf(), rejectedOf()]));
  renderOperator();
  const table = await operatorTable();
  const main = screen.getByRole('main');
  expect(within(main).queryAllByRole('button')).toEqual([]);
  expect(main.querySelectorAll('form, input, select, textarea, [contenteditable]')).toHaveLength(0);
  expect(within(table).queryAllByRole('link')).toEqual([]);
});

test('no row leads into a tenant: no address of the page names an installation', async () => {
  serveOperator(operatorList([installationOf(), rejectedOf()]));
  renderOperator();
  const table = await operatorTable();
  expect(table.querySelectorAll('[href]')).toHaveLength(0);
  expect(table.textContent).not.toContain('/installations/');
});

test("the page carries no signature, signer or personal data: the cells are the endpoint's fields and nothing else", async () => {
  serveOperator(operatorList([installationOf()]));
  renderOperator();
  const table = await operatorTable();
  expect(within(table).getAllByRole('columnheader')).toHaveLength(7);
  expect(table.textContent).not.toMatch(/signature|signer|e-?mail|@/i);
});

test('opening the page sends nothing but GET', async () => {
  const methods: string[] = [];
  server.events.on('request:start', ({ request }) => {
    methods.push(request.method);
  });
  serveOperator(operatorList([installationOf()]));
  renderOperator();
  await operatorTable();
  expect(methods).toContain('GET');
  expect(new Set(methods)).toEqual(new Set(['GET']));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(messages['operator.title']).toBe('Operator installations');
});
