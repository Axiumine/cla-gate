// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { envelope } from '../../api/test-support.ts';
import { messages } from '../../i18n/index.ts';
import { globex, summary, tenantOf } from '../../installations/test-support.ts';
import {
  agree,
  confirmButton,
  countsShown,
  invalidateButton,
  openQuestion,
  previewOf,
  question,
} from './test-support.ts';

// E18-S14: the preview and the invalidation belong to the installation and the document of the address. They are addressed through the
// installation in the URL, the document of another tenant is the uniform 404 of the server and is shown as that, and a question that is
// open does not outlive the tenant it was opened for.

const TENANTS = [tenantOf(summary(), 'acme/widgets'), tenantOf(globex({ role: 'org_admin' }), 'globex/api')];

/** Moves the app to another address the way the browser's Back and Forward do. */
function goTo(path: string): void {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

const pathsOf = (seen: readonly { readonly url: string }[]) => seen.map((one) => new URL(one.url).pathname);

test('the preview and the invalidation are addressed through the installation and the document in the URL', async () => {
  const { invalidated, user } = await openQuestion({
    route: '/installations/6/documents/11?tab=history',
    serve: { tenants: TENANTS },
  });
  await agree(user);
  await user.click(confirmButton());
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  expect(pathsOf(invalidated.preview)).toEqual(['/api/installations/6/documents/11/invalidation-preview']);
  expect(pathsOf(invalidated.invalidate)).toEqual(['/api/installations/6/documents/11/invalidations']);
});

test('a document of another tenant is the uniform 404 of the server, shown in the question with no count and nothing to confirm', async () => {
  await openQuestion({ invalidate: { preview: [envelope(404, 'not_found')] }, countsReady: false });
  const alert = await within(question()).findByRole('alert');
  expect(alert).toHaveTextContent(messages['errors.not_found']);
  expect(within(question()).queryByRole('definition')).toBeNull();
  expect(confirmButton()).toBeDisabled();
});

test('a 404 on the invalidation itself is shown in the question and the question stays', async () => {
  const { user } = await openQuestion({ invalidate: { invalidate: [envelope(404, 'not_found')] } });
  await agree(user);
  await user.click(confirmButton());
  expect(await within(question()).findByRole('alert')).toHaveTextContent(messages['errors.not_found']);
  expect(question()).toBeInTheDocument();
});

test('switching to another installation closes the open question and leaves none of its counts in the cache, and the other one asks for its own', async () => {
  const { invalidated, queryClient, user } = await openQuestion({
    serve: { tenants: TENANTS },
    invalidate: { preview: [previewOf(7, 2), previewOf(3, 1)] },
  });
  goTo('/installations/6/documents/11?tab=history');
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  await screen.findByRole('table', { name: messages['history.caption'] });
  expect(
    queryClient.getQueryCache().findAll({ queryKey: ['installation', 5, 'documents', 11, 'invalidation-preview'] }),
  ).toEqual([]);
  await user.click(invalidateButton(1));
  await countsShown();
  expect(
    within(question())
      .getAllByRole('definition')
      .map((value) => value.textContent),
  ).toEqual(['3', '1']);
  expect(pathsOf(invalidated.preview)).toEqual([
    '/api/installations/5/documents/11/invalidation-preview',
    '/api/installations/6/documents/11/invalidation-preview',
  ]);
});

test('closing the question drops the counts from the cache, so a number is never shown again without being asked for', async () => {
  const { queryClient, user } = await openQuestion();
  const cached = () =>
    queryClient.getQueryCache().findAll({ queryKey: ['installation', 5, 'documents', 11, 'invalidation-preview', 1] });
  expect(cached()).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: messages['common.cancel'] }));
  await waitFor(() => {
    expect(cached()).toEqual([]);
  });
});
