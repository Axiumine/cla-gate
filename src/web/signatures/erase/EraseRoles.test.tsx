// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { json } from '../../api/test-support.ts';
import { globex, summary, tenantOf } from '../../installations/test-support.ts';
import { openSignatures, revokeButton, signaturesTable } from '../test-support.ts';
import { eraseButton, serveErase } from './test-support.ts';

// E18-S14: who is offered the erasure of personal data. Only an org admin: the personal data of a person spans documents, so a repo admin
// has no button, and neither has a person whose role the list of installations does not know. The server still decides on every request,
// and a suspended installation writes nothing.

const erasures = () => within(signaturesTable()).queryAllByRole('button', { name: /^(Erase|The personal data)/ });

test('an org admin is offered the erasure on every row', async () => {
  await openSignatures();
  expect(erasures()).toHaveLength(2);
});

test('a repo admin has Revoke where the server allows it and no way to erase personal data', async () => {
  await openSignatures('/installations/5/signatures?document=11', {
    tenants: [tenantOf(summary({ role: 'repo_admin' }), 'acme/widgets')],
  });
  expect(revokeButton('Ada Lovelace')).toBeInTheDocument();
  expect(erasures()).toEqual([]);
  expect(screen.queryByText(/Erase/)).toBeNull();
});

test('a person the list of installations does not know is offered no erasure, though the signatures are there to read', async () => {
  await openSignatures('/installations/5/signatures', {
    listing: () => json([summary({ id: 6, accountLogin: 'globex' })]),
  });
  expect(erasures()).toEqual([]);
  expect(within(signaturesTable()).getAllByRole('button', { name: /^Details of/ })).toHaveLength(2);
});

test('another installation of the list does not make the person an org admin of this one', async () => {
  await openSignatures('/installations/5/signatures', { tenants: [tenantOf(globex(), 'globex/api')] });
  expect(erasures()).toEqual([]);
});

test('a suspended installation shows the button unavailable, and pressing it opens nothing', async () => {
  const served = serveErase();
  const { user } = await openSignatures('/installations/5/signatures', {
    tenants: [tenantOf(summary({ suspended: true }), 'acme/widgets')],
  });
  expect(eraseButton('Ada Lovelace')).toBeDisabled();
  await user.click(eraseButton('Ada Lovelace'));
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(served.preview).toEqual([]);
});
