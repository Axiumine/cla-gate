// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { envelope } from '../api/test-support.ts';
import { held } from '../documents/test-support.ts';
import { messages } from '../i18n/index.ts';
import { documentsOf } from '../repositories/test-support.ts';
import {
  ALLOWLIST_ROUTE,
  addButton,
  entriesTable,
  pathOf,
  REPOSITORY_ROUTE,
  renderAllowlist,
  serveAllowlist,
} from './test-support.ts';

// The repository in `?repository=` is shown only when it belongs to the installation in the address (a review finding on E18-S06): the
// allowlist of a repository is addressed by the repository id alone, so the page asks the installation first.

test('the whole installation asks nothing about a repository', async () => {
  const served = serveAllowlist();
  renderAllowlist(ALLOWLIST_ROUTE);
  await screen.findByRole('table', { name: messages['allowlist.caption'] });
  expect(served.membership).toEqual([]);
});

test('a repository is asked about through the installation in the address, and its entries only once that has answered', async () => {
  const gate = held(documentsOf());
  const served = serveAllowlist({ membership: [gate.answer] });
  renderAllowlist(REPOSITORY_ROUTE);
  await waitFor(() => {
    expect(served.membership).toHaveLength(1);
  });
  expect(screen.getByText(messages['states.loading'])).toBeInTheDocument();
  expect(served.membership.map(pathOf)).toEqual(['/api/installations/5/repositories/1/documents']);
  expect(served.repositoryList).toEqual([]);
  expect(screen.queryByRole('button', { name: messages['allowlist.add'] })).toBeNull();
  gate.release();
  expect(await screen.findByRole('table', { name: messages['allowlist.caption'] })).toBeInTheDocument();
  expect(served.repositoryList.map(pathOf)).toEqual(['/api/repositories/1/allowlist-entries']);
  expect(addButton()).toBeEnabled();
});

test('a check that fails is the error state with "Try again", and the entries wait for the retry', async () => {
  const served = serveAllowlist({ membership: [envelope(500, 'internal_server_error'), documentsOf()] });
  const { user } = renderAllowlist(REPOSITORY_ROUTE);
  const state = await screen.findByRole('alert');
  expect(state).toHaveTextContent(messages['errors.internal_server_error']);
  expect(served.repositoryList).toEqual([]);
  await user.click(within(state).getByRole('button', { name: messages['states.retry'] }));
  expect(await screen.findByRole('table', { name: messages['allowlist.caption'] })).toBeInTheDocument();
  expect(served.membership).toHaveLength(2);
  expect(entriesTable()).toBeInTheDocument();
});

test('a check that is refused is the forbidden state, with no retry and no entries', async () => {
  const served = serveAllowlist({ membership: [envelope(403, 'forbidden')] });
  renderAllowlist(REPOSITORY_ROUTE);
  const state = await screen.findByRole('alert');
  expect(state).toHaveTextContent(messages['errors.forbidden']);
  expect(within(state).queryByRole('button', { name: messages['states.retry'] })).toBeNull();
  expect(served.repositoryList).toEqual([]);
});
