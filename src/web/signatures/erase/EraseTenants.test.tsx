// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { messages } from '../../i18n/index.ts';
import { globex, summary, tenantOf } from '../../installations/test-support.ts';
import { bodyOf, graceOf, pageOf, signatureOf, signaturesTable } from '../test-support.ts';
import {
  cancelButton,
  confirmButton,
  countsShown,
  eraseButton,
  nothingHeld,
  openErase,
  previewOf,
  question,
} from './test-support.ts';

// E18-S14: the preview and the erasure belong to the installation of the address. They are addressed through the installation in the
// URL, a person the installation holds nothing of is the uniform 404 of the server and is shown as "nothing to erase", and a question that
// is open does not outlive the tenant it was opened for.

const TENANTS = [tenantOf(summary(), 'acme/widgets'), tenantOf(globex({ role: 'org_admin' }), 'globex/api')];
const SIX = '/installations/6/signatures';
const pathsOf = (seen: readonly { readonly url: string }[]) => seen.map((one) => new URL(one.url).pathname);

/** Moves the app to another address the way the browser's Back and Forward do. */
function goTo(path: string): void {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

test('the preview and the erasure are addressed through the installation in the URL, and the person by numeric id in the query and the body', async () => {
  const { erased, user } = await openErase({ route: SIX, signatures: { tenants: TENANTS } });
  await user.click(confirmButton());
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  expect(pathsOf(erased.preview)).toEqual(['/api/installations/6/erasure-preview']);
  expect(new URL(erased.preview[0]?.url ?? '').search).toBe('?githubUserId=4711');
  expect(pathsOf(erased.erase)).toEqual(['/api/installations/6/erasures']);
  expect(bodyOf(erased.erase[0])).toEqual({ githubUserId: 4711, expectedRows: 2 });
});

test('a person the installation holds nothing of, such as one whose rows are in another tenant, is the uniform 404 and the question says there is nothing to erase', async () => {
  await openErase({ erase: { preview: [nothingHeld()] }, ready: false });
  expect(await within(question()).findByText(messages['erase.nothing'])).toBeInTheDocument();
  expect(within(question()).queryByRole('list')).toBeNull();
  expect(confirmButton()).toBeDisabled();
});

test('switching to another installation closes the open question and leaves none of its counts in the cache, and the other one asks for its own', async () => {
  const { erased, queryClient, user } = await openErase({
    signatures: {
      tenants: TENANTS,
      search: [pageOf([signatureOf(), graceOf()]), pageOf([signatureOf({ id: 950 })])],
    },
    erase: { preview: [previewOf(2, 2), previewOf(1, 1)] },
  });
  goTo(SIX);
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  await screen.findByRole('table', { name: messages['signatures.caption'] });
  expect(queryClient.getQueryCache().findAll({ queryKey: ['installation', 5, 'erasure-preview'] })).toEqual([]);
  expect(within(signaturesTable()).queryByText('Grace Hopper')).toBeNull();
  await user.click(eraseButton('Ada Lovelace'));
  await countsShown();
  expect(within(question()).getAllByRole('listitem')[0]).toHaveTextContent('(1 record)');
  expect(pathsOf(erased.preview)).toEqual([
    '/api/installations/5/erasure-preview',
    '/api/installations/6/erasure-preview',
  ]);
});

test('closing the question drops the counts from the cache, so a number is never shown again without being asked for', async () => {
  const { queryClient, user } = await openErase();
  const cached = () => queryClient.getQueryCache().findAll({ queryKey: ['installation', 5, 'erasure-preview', 4711] });
  expect(cached()).toHaveLength(1);
  await user.click(cancelButton());
  await waitFor(() => {
    expect(cached()).toEqual([]);
  });
});
