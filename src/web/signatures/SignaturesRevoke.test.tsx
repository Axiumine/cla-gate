// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { held } from '../documents/test-support.ts';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { expectRevokeReasonChoices } from '../test-support/revoke-reasons.ts';
import {
  bodyOf,
  confirmButton,
  erasedOf,
  graceOf,
  openSignatures,
  pageOf,
  pathOf,
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

// E18-S07: revoking a signature: a question that names the signer and asks for a reason, one request to the installation of the address,
// and what the row, the focus and the live region do once the list says it is revoked.

const ADA = signatureOf();
const ADA_REVOKED = revokedOf({ id: 900 });
const cancel = () => within(revokeDialog()).getByRole('button', { name: messages['common.cancel'] });
const statuses = () => rowsOf(signaturesTable()).map((cells) => cells[6]);

/** Opens the question of the first row and chooses the reason. */
async function ask(user: UserEvent, name = 'Ada Lovelace', reason = 'legal_request') {
  await user.click(revokeButton(name));
  await screen.findByRole('alertdialog');
  await user.selectOptions(reasonSelect(), reason);
}

test('each row has a Revoke button that names its signer, and the question names the signer and says that revocation is prospective only', async () => {
  const { user } = await openSignatures();
  expect(revokeButton('Grace Hopper')).toBeInTheDocument();
  await user.click(revokeButton('Ada Lovelace'));
  const question = await screen.findByRole('alertdialog', {
    name: `${messages['signatures.revoke.title']} Ada Lovelace`,
  });
  expect(question).toHaveAccessibleDescription(messages['signatures.revoke.description']);
  expect(question).toHaveTextContent(
    'Revocation applies to future pull requests only; contributions already accepted stay licensed.',
  );
  expect(cancel()).toHaveFocus();
});

test('the reason is a required choice of the four codes in the words of the catalog, and there is no free-text field', async () => {
  const { user } = await openSignatures();
  await user.click(revokeButton('Ada Lovelace'));
  await screen.findByRole('alertdialog');
  expectRevokeReasonChoices(reasonSelect());
  expect(reasonSelect()).toHaveValue('');
  expect(within(revokeDialog()).queryByRole('textbox')).toBeNull();
});

test('confirming with no reason sends nothing, keeps the question open and says the reason is needed; choosing one takes the message away', async () => {
  const { served, user } = await openSignatures();
  await user.click(revokeButton('Ada Lovelace'));
  await screen.findByRole('alertdialog');
  await user.click(confirmButton());
  expect(await within(revokeDialog()).findByRole('alert')).toHaveTextContent(
    messages['signatures.revoke.reason.required'],
  );
  expect(reasonSelect()).toHaveAttribute('aria-invalid', 'true');
  expect(served.revoke).toEqual([]);
  await user.selectOptions(reasonSelect(), 'other');
  expect(within(revokeDialog()).queryByRole('alert')).toBeNull();
  await user.selectOptions(reasonSelect(), '');
  expect(reasonSelect()).toHaveValue('');
});

test('Escape does nothing, Cancel closes the question with no request, and focus returns to the row button', async () => {
  const { served, user } = await openSignatures();
  await user.click(revokeButton('Ada Lovelace'));
  await screen.findByRole('alertdialog');
  await user.keyboard('{Escape}');
  expect(revokeDialog()).toBeInTheDocument();
  await user.click(cancel());
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  expect(served.revoke).toEqual([]);
  expect(revokeButton('Ada Lovelace')).toHaveFocus();
});

test('confirming sends one POST with the reason code and nothing else to the installation of the address, then asks for the list again', async () => {
  const { served, user } = await openSignatures(SIGNATURES_ROUTE, {
    search: [pageOf([ADA, graceOf()]), pageOf([ADA_REVOKED, graceOf()])],
  });
  await ask(user);
  await user.click(confirmButton());
  await waitFor(() => {
    expect(statuses()).toEqual([messages['status.revoked'], messages['status.active']]);
  });
  expect(served.revoke.map((seen) => [seen.method, pathOf(seen)])).toEqual([
    ['POST', '/api/installations/5/signatures/900/revoke'],
  ]);
  expect(bodyOf(served.revoke[0])).toEqual({ reasonCode: 'legal_request' });
  expect(served.revoke[0]?.headers['x-csrf-token']).toBeTruthy();
  expect(served.search).toHaveLength(2);
});

test('once the list says Revoked the question closes, the live region says so, and focus returns to the button of the row, which is unavailable now', async () => {
  const { user } = await openSignatures(SIGNATURES_ROUTE, {
    search: [pageOf([ADA, graceOf()]), pageOf([ADA_REVOKED, graceOf()])],
  });
  await ask(user);
  await user.click(confirmButton());
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  const notice = screen.getByText(messages['signatures.notice.revoked']);
  expect(notice.closest('[role="status"]')).toHaveAttribute('aria-live', 'polite');
  const button = revokeButton('Ada Lovelace');
  expect(button).toHaveAttribute('aria-disabled', 'true');
  await waitFor(() => {
    expect(button).toHaveFocus();
  });
});

test('the action is unavailable for a row that is revoked already, and pressing it opens nothing', async () => {
  const { user } = await openSignatures(SIGNATURES_ROUTE, { search: [pageOf([ADA_REVOKED, graceOf()])] });
  const button = revokeButton('Ada Lovelace');
  expect(button).toHaveAttribute('aria-disabled', 'true');
  await user.click(button);
  button.focus();
  await user.keyboard('{Enter}');
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(revokeButton('Grace Hopper')).not.toHaveAttribute('aria-disabled');
});

test('the confirm button is busy while the request is out, a second confirmation sends no second request, and Cancel does not close the question', async () => {
  const gate = held(revokedAs(900));
  const { served, user } = await openSignatures(SIGNATURES_ROUTE, {
    search: [pageOf([ADA]), pageOf([ADA_REVOKED])],
    revoke: [gate.answer],
  });
  await ask(user);
  await user.click(confirmButton());
  await waitFor(() => {
    expect(confirmButton()).toHaveAttribute('aria-busy', 'true');
  });
  await user.click(confirmButton());
  await user.click(cancel());
  expect(revokeDialog()).toBeInTheDocument();
  expect(served.revoke).toHaveLength(1);
  gate.release();
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  expect(served.revoke).toHaveLength(1);
});

test('a revoked signature that a status filter no longer lists leaves the list, and focus goes to the heading of the results', async () => {
  const { user } = await openSignatures(`${SIGNATURES_ROUTE}?state=active`, {
    search: [pageOf([ADA, graceOf()]), pageOf([graceOf()])],
  });
  await ask(user);
  await user.click(confirmButton());
  await waitFor(() => {
    expect(rowsOf(signaturesTable())).toHaveLength(1);
  });
  expect(screen.queryByRole('alertdialog')).toBeNull();
  await waitFor(() => {
    expect(screen.getByRole('heading', { level: 2, name: messages['signatures.results.title'] })).toHaveFocus();
  });
});

test('the last signature of a filtered list that is revoked leaves the empty state, and focus goes to the heading', async () => {
  const { user } = await openSignatures(`${SIGNATURES_ROUTE}?state=active`, {
    search: [pageOf([ADA]), pageOf([])],
  });
  await ask(user);
  await user.click(confirmButton());
  expect(
    await screen.findByRole('heading', { level: 3, name: messages['signatures.empty.title'] }),
  ).toBeInTheDocument();
  await waitFor(() => {
    expect(screen.getByRole('heading', { level: 2, name: messages['signatures.results.title'] })).toHaveFocus();
  });
});

test('a signer whose personal data was erased is named by the GitHub id in the button and in the question', async () => {
  const { user } = await openSignatures(SIGNATURES_ROUTE, { search: [pageOf([erasedOf()])] });
  await user.click(revokeButton('GitHub user 9001'));
  expect(
    await screen.findByRole('alertdialog', { name: `${messages['signatures.revoke.title']} GitHub user 9001` }),
  ).toBeInTheDocument();
});

test('the question is keyboard-complete: Enter opens it, Tab moves round its controls and back to Cancel, and Enter on the confirm button sends the request', async () => {
  const { served, user } = await openSignatures();
  revokeButton('Ada Lovelace').focus();
  await user.keyboard('{Enter}');
  await screen.findByRole('alertdialog');
  expect(cancel()).toHaveFocus();
  await user.tab();
  expect(confirmButton()).toHaveFocus();
  await user.tab();
  expect(reasonSelect()).toHaveFocus();
  await user.tab();
  expect(cancel()).toHaveFocus();
  await user.keyboard('{Shift>}{Tab}{/Shift}');
  expect(reasonSelect()).toHaveFocus();
  await user.selectOptions(reasonSelect(), 'signer_request');
  await user.tab();
  await user.tab();
  expect(confirmButton()).toHaveFocus();
  await user.keyboard('{Enter}');
  await waitFor(() => {
    expect(served.revoke).toHaveLength(1);
  });
  expect(bodyOf(served.revoke[0])).toEqual({ reasonCode: 'signer_request' });
});

test.each(['signer_request', 'maintainer_decision', 'legal_request', 'other'])(
  'the reason %s is sent as its code',
  async (code) => {
    const { served, user } = await openSignatures();
    await ask(user, 'Ada Lovelace', code);
    await user.click(confirmButton());
    await waitFor(() => {
      expect(served.revoke).toHaveLength(1);
    });
    expect(bodyOf(served.revoke[0])).toEqual({ reasonCode: code });
  },
);

test('axe passes on the question of a revocation, with and without the reason missing', async () => {
  const { user } = await openSignatures();
  await user.click(revokeButton('Ada Lovelace'));
  await screen.findByRole('alertdialog');
  await expectNoA11yViolations(document.body);
  await user.click(confirmButton());
  await within(revokeDialog()).findByRole('alert');
  await expectNoA11yViolations(document.body);
});
