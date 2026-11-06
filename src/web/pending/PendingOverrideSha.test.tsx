// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { recordOverrideRoute } from '../../shared/pending-routes.ts';
import { ContractError } from '../api/index.ts';
import { json, testClient } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { ALICE } from '../test-support/session.ts';
import { RecordOverride } from './RecordOverride.tsx';
import {
  bodyOf,
  heading,
  PENDING_ROUTE,
  pendingOf,
  reasonField,
  recordDialog,
  renderPending,
  servePending,
  submitButton,
  unlinked,
} from './test-support.ts';

// E18-S08: a commit id that is not 40 or 64 hexadecimal characters is rejected in the browser by the shared schema of the request, before
// any request: by the dialog, by the client, and by the contract of the pending list itself.

const ACTIONS = {
  installationId: 5,
  suspended: false,
  onRecorded: vi.fn<() => void>(),
  onVanished: vi.fn<() => void>(),
};

async function openFor(commitSha: string) {
  const served = servePending();
  const rendered = renderWithProviders(
    <RecordOverride actions={ACTIONS} repository={{ id: 1, fullName: 'acme/widgets' }} commitSha={commitSha} />,
    { session: ALICE },
  );
  await rendered.user.click(await screen.findByRole('button', { name: /^Record override/ }));
  await screen.findByRole('dialog');
  await rendered.user.type(reasonField(), 'Work email');
  await rendered.user.click(submitButton());
  return { served, ...rendered };
}

test.each([
  ['an abbreviated id', 'a1b2c3d'],
  ['a branch name', 'main'],
  ['an id of 39 characters', 'a'.repeat(39)],
  ['an id of 41 characters', 'a'.repeat(41)],
  ['an id with a character that is not hexadecimal', `${'a'.repeat(39)}g`],
  ['an upper-case id', 'A'.repeat(40)],
  ['an id with a blank around it', ` ${'a'.repeat(40)}`],
])('%s is refused under the commit field, and no request is sent', async (_what, commitSha) => {
  const { served } = await openFor(commitSha);
  expect(await within(recordDialog()).findByText(messages['pending.override.sha.invalid'])).toBeInTheDocument();
  expect(served.record).toEqual([]);
  expect(recordDialog()).toBeInTheDocument();
});

test('a full SHA-256 commit id of 64 characters goes', async () => {
  const { served } = await openFor('d'.repeat(64));
  await vi.waitFor(() => {
    expect(served.record).toHaveLength(1);
  });
  expect(bodyOf(served.record[0])).toEqual({ commitSha: 'd'.repeat(64), reason: 'Work email' });
});

test('the client itself refuses a record for an abbreviated id with a contract error about the body, before any request', async () => {
  const { client, sent } = testClient();
  const failure = await client
    .call(recordOverrideRoute, { params: { repositoryId: 1 }, body: { commitSha: 'abc', reason: 'x' } })
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  expect(failure).toBeInstanceOf(ContractError);
  expect(failure).toMatchObject({ part: 'body' });
  expect(sent).toEqual([]);
});

test('a pending list that names a commit that is not a full id is a contract error: no table, no button, and nothing is sent', async () => {
  const bad = {
    items: [{ ...pendingOf(), reasons: [{ ...unlinked(), commitSha: 'a1b2c3d' }] }],
    nextCursor: null,
    truncated: false,
  };
  const served = servePending({ pending: [json(bad)] });
  renderPending(PENDING_ROUTE);
  await heading(messages['pending.title']);
  expect(await screen.findByRole('alert')).toHaveTextContent(messages['errors.contract']);
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByRole('button', { name: /^Record override/ })).toBeNull();
  expect(served.record).toEqual([]);
});
