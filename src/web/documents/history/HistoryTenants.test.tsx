// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { envelope } from '../../api/test-support.ts';
import { messages } from '../../i18n/index.ts';
import { globex, summary, tenantOf } from '../../installations/test-support.ts';
import { publishedAs } from '../test-support.ts';
import {
  historyVersion,
  openHistory,
  openRestore,
  pageOf,
  publishWith,
  rationaleOf,
  restoreDialog,
  V1_0,
  V1_1,
  versionsTable,
  viewButton,
  viewer,
} from './test-support.ts';

// E18-S11: the history is the history of the tenant and the document in the address, and the role of the person is the server's: a
// refusal is shown where it came and takes nothing off the screen that was already there.

const TENANTS = [tenantOf(summary(), 'acme/widgets'), tenantOf(globex(), 'globex/api')];

const numbers = () =>
  within(versionsTable())
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.querySelector('td')?.textContent);

/** Moves the app to another address the way the browser's Back and Forward do. */
function goTo(path: string): void {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

test("the same document id under another tenant is that tenant's history: the other tenant's rows are gone and the request names the new tenant", async () => {
  const globexOnly = historyVersion({ id: 901, major: 9, minor: 4, rationale: 'Zzzz globex row' });
  const { served } = await openHistory({
    serve: { tenants: TENANTS },
    history: { list: [pageOf([V1_1, V1_0]), pageOf([globexOnly])] },
  });
  expect(numbers()).toEqual(['1.1', '1.0']);
  goTo('/installations/6/documents/11?tab=history');
  await waitFor(() => {
    expect(numbers()).toEqual(['9.4']);
  });
  expect(screen.queryByText('Fixed a typo')).toBeNull();
  expect(served.list.map((seen) => new URL(seen.url).pathname)).toEqual([
    '/api/installations/5/documents/11/versions',
    '/api/installations/6/documents/11/versions',
  ]);
});

test('a version opened under one tenant is not shown under another, whatever the version id', async () => {
  const { user, served } = await openHistory({ serve: { tenants: TENANTS } });
  await user.click(viewButton('1.1'));
  await viewer('1.1');
  goTo('/installations/6/documents/11?tab=history&view=302');
  await waitFor(() => {
    expect(served.read.at(-1)?.url).toContain('/api/installations/6/documents/11/versions/302');
  });
  const asked = served.read.map((seen) => new URL(seen.url).pathname).filter((path) => path.endsWith('/versions/302'));
  expect(asked).toEqual([
    '/api/installations/5/documents/11/versions/302',
    '/api/installations/6/documents/11/versions/302',
  ]);
});

test('a 403 on a text of the comparison is the forbidden state of the comparison, and the list above stays', async () => {
  await openHistory({
    route: '/installations/5/documents/11?tab=history&compare=true&from=301&to=303',
    history: { read: new Map([[V1_0.id, () => envelope(403, 'forbidden')]]) },
  });
  const region = await screen.findByRole('region', { name: messages['history.compare.title'] });
  expect(await within(region).findByText(messages['states.forbidden.title'])).toBeInTheDocument();
  expect(numbers()).toEqual(['2.0', '1.1', '1.0']);
});

test('a repo admin sees the history and is offered the restore, and the server decides: its 403 is said in the dialog', async () => {
  const opened = await openRestore('1.1', {
    serve: { tenants: [tenantOf(globex(), 'globex/api')], publish: [envelope(403, 'forbidden')] },
    route: '/installations/6/documents/11?tab=history',
  });
  await publishWith(opened);
  expect(await within(opened.dialog).findByText(messages['errors.forbidden'])).toBeInTheDocument();
  expect(opened.dialog).toBeInTheDocument();
  expect(rationaleOf(opened.dialog)).toHaveValue('Went back to the earlier wording');
  expect(screen.getByText('One point one.')).toBeInTheDocument();
});

test('an org admin of the tenant restores through the tenant in the address', async () => {
  const opened = await openRestore('1.1', { serve: { tenants: TENANTS, publish: [publishedAs(3, 0)] } });
  await publishWith(opened);
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(new URL(opened.documents.publish[0]?.url ?? '').pathname).toBe('/api/installations/5/documents/11/versions');
  await expect(restoreDialog('1.1')).rejects.toThrow();
});
