// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { envelope, json } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  confirmButton,
  graceOf,
  notFound,
  openSignatures,
  pageOf,
  reasonSelect,
  revokeButton,
  revokeDialog,
  revokedAs,
  revokedOf,
  rowsOf,
  SIGNATURES_ROUTE,
  signatureOf,
  signaturesTable,
} from './test-support.ts';

// E18-S07: what a revocation that is refused does: `409 already_revoked` asks for the list again, a `403` is shown in the question
// which stays open, and so is every other failure; a new attempt clears what the last one left.

const ADA = signatureOf();
const cancel = () => within(revokeDialog()).getByRole('button', { name: messages['common.cancel'] });

async function confirmOther(user: UserEvent) {
  await user.click(revokeButton('Ada Lovelace'));
  await screen.findByRole('alertdialog');
  await user.selectOptions(reasonSelect(), 'other');
  await user.click(confirmButton());
}

test('409 already_revoked asks for the list again, closes the question, and says in the live region that it was revoked already', async () => {
  const { served, user } = await openSignatures(SIGNATURES_ROUTE, {
    search: [pageOf([ADA, graceOf()]), pageOf([revokedOf({ id: 900 }), graceOf()])],
    revoke: [envelope(409, 'already_revoked')],
  });
  await confirmOther(user);
  const notice = await screen.findByText(messages['signatures.notice.alreadyRevoked']);
  expect(notice.closest('[role="status"]')).not.toBeNull();
  expect(served.search).toHaveLength(2);
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(rowsOf(signaturesTable())[0]?.[6]).toBe(messages['status.revoked']);
  await waitFor(() => {
    expect(revokeButton('Ada Lovelace')).toHaveFocus();
  });
});

test('403 renders in the question as the forbidden state, which stays open, asks for nothing again, and Cancel closes', async () => {
  const { served, user } = await openSignatures(SIGNATURES_ROUTE, { revoke: [envelope(403, 'forbidden')] });
  await confirmOther(user);
  expect(await within(revokeDialog()).findByRole('alert')).toHaveTextContent(messages['errors.forbidden']);
  expect(revokeDialog()).toBeInTheDocument();
  expect(served.search).toHaveLength(1);
  expect(screen.queryByText(messages['signatures.notice.revoked'])).toBeNull();
  await user.click(cancel());
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  expect(rowsOf(signaturesTable())[0]?.[6]).toBe(messages['status.active']);
});

test('404 for a signature the tenant does not have is the not-found state in the question, which stays open', async () => {
  const { served, user } = await openSignatures(SIGNATURES_ROUTE, { revoke: [notFound()] });
  await confirmOther(user);
  expect(await within(revokeDialog()).findByRole('alert')).toHaveTextContent(messages['errors.not_found']);
  expect(revokeDialog()).toBeInTheDocument();
  expect(served.search).toHaveLength(1);
});

test.each([
  ['502', 502, 'github_unavailable', messages['errors.github_unavailable']],
  ['500', 500, 'internal_server_error', messages['errors.internal_server_error']],
  ['429', 429, 'too_many_requests', messages['errors.too_many_requests']],
  ['400', 400, 'bad_request', messages['errors.bad_request']],
  [
    'a 422 with the code of the rule, which is not the status of the rule',
    422,
    'already_revoked',
    messages['errors.unknown'],
  ],
])(
  '%s is the error state in the question, which stays open and keeps the reason',
  async (_what, status, code, text) => {
    const { served, user } = await openSignatures(SIGNATURES_ROUTE, { revoke: [envelope(status, code)] });
    await confirmOther(user);
    expect(await within(revokeDialog()).findByRole('alert')).toHaveTextContent(text);
    expect(reasonSelect()).toHaveValue('other');
    expect(served.search).toHaveLength(1);
    expect(revokeDialog()).toBeInTheDocument();
  },
);

test('a new attempt takes the error away and goes through', async () => {
  const { served, user } = await openSignatures(SIGNATURES_ROUTE, {
    search: [pageOf([ADA]), pageOf([revokedOf({ id: 900 })])],
    revoke: [envelope(502, 'github_unavailable'), revokedAs(900)],
  });
  await confirmOther(user);
  await within(revokeDialog()).findByRole('alert');
  await user.click(confirmButton());
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  expect(served.revoke).toHaveLength(2);
  expect(screen.getByText(messages['signatures.notice.revoked'])).toBeInTheDocument();
});

test('a question that is opened again starts empty: no error and no reason of the attempt before', async () => {
  const { user } = await openSignatures(SIGNATURES_ROUTE, { revoke: [envelope(502, 'github_unavailable')] });
  await confirmOther(user);
  await within(revokeDialog()).findByRole('alert');
  await user.click(cancel());
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  await user.click(revokeButton('Ada Lovelace'));
  await screen.findByRole('alertdialog');
  expect(within(revokeDialog()).queryByRole('alert')).toBeNull();
  expect(reasonSelect()).toHaveValue('');
});

test('an answer that does not match the contract is the contract error in the question, and the row stays as it was', async () => {
  const { user } = await openSignatures(SIGNATURES_ROUTE, { revoke: [json({ signature: { id: 900 } })] });
  await confirmOther(user);
  expect(await within(revokeDialog()).findByRole('alert')).toHaveTextContent(messages['errors.contract']);
  await user.click(cancel());
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  expect(rowsOf(signaturesTable())[0]?.[6]).toBe(messages['status.active']);
});

test('axe passes on the question that shows a refusal', async () => {
  const { user } = await openSignatures(SIGNATURES_ROUTE, { revoke: [envelope(403, 'forbidden')] });
  await confirmOther(user);
  await within(revokeDialog()).findByRole('alert');
  await expectNoA11yViolations(document.body);
});
