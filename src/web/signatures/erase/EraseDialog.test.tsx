// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { held } from '../../documents/test-support.ts';
import { messages } from '../../i18n/index.ts';
import { expectNoA11yViolations } from '../../test-support/a11y.ts';
import {
  bodyOf,
  EMAIL,
  erasedOf,
  graceOf,
  openSignatures,
  pageOf,
  revokeButton,
  revokedAs,
  signatureOf,
  signaturesTable,
} from '../test-support.ts';
import {
  cancelButton,
  confirmButton,
  countsShown,
  eraseButton,
  erasedAs,
  erasedButton,
  openErase,
  previewOf,
  question,
  serveErase,
} from './test-support.ts';

// E18-S14: erasing a signer's personal data: a question that says what is removed and what stays, from counts the server made, and sends
// one request to the installation of the address.

const ADA = signatureOf();
const ADA_ERASED = (id: number) => erasedOf({ id, githubUserId: 4711 });
const closed = () =>
  waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
const listed = () =>
  within(question())
    .getAllByRole('listitem')
    .map((item) => item.textContent);

test('an org admin has "Erase personal data" on every row, and its name says whose', async () => {
  await openSignatures();
  expect(eraseButton('Ada Lovelace')).toHaveTextContent(messages['erase.action']);
  expect(eraseButton('Grace Hopper')).toBeEnabled();
});

test('the question names the signer, says that it cannot be undone and that no signature is touched, and starts on Cancel', async () => {
  await openErase();
  expect(question()).toHaveAccessibleName(`${messages['erase.title']} Ada Lovelace`);
  expect(question()).toHaveAccessibleDescription(messages['erase.description']);
  expect(question()).toHaveTextContent('It cannot be undone, and it does not touch any signature.');
  expect(cancelButton()).toHaveFocus();
});

test('it asks for the counts of the person by numeric id through the installation, and shows what is removed and what stays, with no personal data', async () => {
  const { erased } = await openErase({ erase: { preview: [previewOf(2, 3, 0)] } });
  expect(erased.preview.map((seen) => new URL(seen.url).pathname + new URL(seen.url).search)).toEqual([
    '/api/installations/5/erasure-preview?githubUserId=4711',
  ]);
  expect(
    within(question())
      .getAllByRole('heading')
      .map((heading) => heading.textContent),
  ).toEqual([`${messages['erase.title']} Ada Lovelace`, messages['erase.removes'], messages['erase.stays']]);
  expect(listed()).toEqual([
    'The name, email address and GitHub login the person gave when signing (3 records).',
    messages['erase.removes.sessions'],
    '2 signatures stay, still valid, as the legal evidence of what was agreed.',
    messages['erase.stays.again'],
  ]);
  expect(question().textContent).not.toContain(EMAIL);
  expect(question().textContent).not.toContain('octocat');
});

test('an allowlist entry that names the person is counted among what is removed, and one record and one signature are said in the singular', async () => {
  await openErase({ erase: { preview: [previewOf(1, 1, 1)] } });
  expect(listed()).toEqual([
    'The name, email address and GitHub login the person gave when signing (1 record).',
    'The login shown on 1 allowlist entry. The entry stays, kept by GitHub id.',
    messages['erase.removes.sessions'],
    '1 signature stays, still valid, as the legal evidence of what was agreed.',
    messages['erase.stays.again'],
  ]);
});

test('several allowlist entries are said in the plural', async () => {
  await openErase({ erase: { preview: [previewOf(1, 0, 4)] } });
  expect(listed()[1]).toBe('The login shown on 4 allowlist entries. The entries stay, kept by GitHub id.');
});

test('an approval of a corporate agreement that names the person is counted among what is removed, after the allowlist entries', async () => {
  await openErase({ erase: { preview: [previewOf(1, 1, 1, { corporateApprovals: 1 })] } });
  expect(listed().slice(1, 3)).toEqual([
    'The login shown on 1 allowlist entry. The entry stays, kept by GitHub id.',
    'The login kept with 1 corporate approval. The approval stays, kept by GitHub id.',
  ]);
});

test('several approvals of a corporate agreement are said in the plural', async () => {
  await openErase({ erase: { preview: [previewOf(1, 0, 0, { corporateApprovals: 3 })] } });
  expect(listed()[1]).toBe('The login kept with 3 corporate approvals. The approvals stay, kept by GitHub id.');
});

test('Escape cancels the question with no request, as Cancel does, and focus returns to the button of the row', async () => {
  const { erased, user } = await openErase();
  await user.keyboard('{Escape}');
  await closed();
  expect(erased.erase).toEqual([]);
  expect(eraseButton('Ada Lovelace')).toHaveFocus();
  await user.click(eraseButton('Ada Lovelace'));
  await countsShown();
  await user.click(cancelButton());
  await closed();
  expect(erased.erase).toEqual([]);
  expect(eraseButton('Ada Lovelace')).toHaveFocus();
});

test('confirming sends one POST with the id and the number of rows that were seen, and nothing else, to the installation of the address', async () => {
  const { erased, user } = await openErase({ erase: { preview: [previewOf(2, 3, 0)], erase: [erasedAs(3)] } });
  await user.click(confirmButton());
  await closed();
  expect(erased.erase.map((seen) => [seen.method, new URL(seen.url).pathname])).toEqual([
    ['POST', '/api/installations/5/erasures'],
  ]);
  expect(bodyOf(erased.erase[0])).toEqual({ githubUserId: 4711, expectedRows: 3 });
  expect(erased.erase[0]?.headers['x-csrf-token']).toBeTruthy();
});

test('it is not optimistic: the row keeps the name until the list says Erased, then the question closes, the live region says how many rows were erased, the row reads "Erased" and focus returns to its button', async () => {
  const gate = held(erasedAs(2));
  const { erased, user } = await openErase({
    erase: { erase: [gate.answer] },
    signatures: { search: [pageOf([ADA, graceOf()]), pageOf([ADA_ERASED(900), graceOf()])] },
  });
  await user.click(confirmButton());
  expect(confirmButton()).toHaveAttribute('aria-busy', 'true');
  expect(erased.erase).toHaveLength(1);
  expect(screen.queryByRole('button', { name: /^The personal data of/ })).toBeNull();
  gate.release();
  await closed();
  expect(
    screen
      .getByText('Personal data erased: 2 records removed. The signatures stay as legal evidence.')
      .closest('[role="status"]'),
  ).toHaveAttribute('aria-live', 'polite');
  const button = erasedButton('GitHub user 4711');
  expect(button).toHaveTextContent(messages['signatures.signer.erased']);
  expect(button).toHaveAttribute('aria-disabled', 'true');
  await waitFor(() => {
    expect(button).toHaveFocus();
  });
  expect(signaturesTable()).toHaveTextContent(messages['signatures.signer.erased']);
  expect(erased.erase).toHaveLength(1);
});

test('a double click sends one request, and neither Cancel nor Escape closes the question while it is out', async () => {
  const gate = held(erasedAs(1));
  const { erased, user } = await openErase({ erase: { preview: [previewOf(1, 1)], erase: [gate.answer] } });
  await user.dblClick(confirmButton());
  await user.click(cancelButton());
  await user.keyboard('{Escape}');
  expect(question()).toBeInTheDocument();
  expect(erased.erase).toHaveLength(1);
  gate.release();
  await closed();
  expect(erased.erase).toHaveLength(1);
  expect(
    screen.getByText('Personal data erased: 1 record removed. The signatures stay as legal evidence.'),
  ).toBeInTheDocument();
});

test('the button of a row that is erased already is unavailable, and pressing it with the mouse or the keyboard opens nothing', async () => {
  const served = serveErase();
  const { user } = await openSignatures('/installations/5/signatures', {
    search: [pageOf([erasedOf(), graceOf()])],
  });
  const button = erasedButton('GitHub user 9001');
  expect(button).toHaveAttribute('aria-disabled', 'true');
  await user.click(button);
  button.focus();
  await user.keyboard('{Enter}');
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(served.preview).toEqual([]);
  expect(eraseButton('Grace Hopper')).not.toHaveAttribute('aria-disabled');
});

const GRACE_REVOKED = graceOf({
  state: 'revoked',
  revokedAt: '2026-11-03T08:15:00.000Z',
  revokedByGithubId: 4712,
  revokeReasonCode: 'other',
});

/** Revokes the signature of Grace Hopper through the revoke question of the row. */
async function revokeGrace(user: Awaited<ReturnType<typeof openSignatures>>['user']): Promise<void> {
  await user.click(revokeButton('Grace Hopper'));
  await user.selectOptions(await screen.findByRole('combobox', { name: /^Reason/ }), 'other');
  await user.click(screen.getByRole('button', { name: messages['signatures.revoke.confirm'] }));
  await closed();
}

test('a revocation replaces what the erasure said in the live region', async () => {
  const { user } = await openErase({
    signatures: {
      search: [
        pageOf([ADA, graceOf()]),
        pageOf([ADA_ERASED(900), graceOf()]),
        pageOf([ADA_ERASED(900), GRACE_REVOKED]),
      ],
      revoke: [revokedAs(901)],
    },
  });
  await user.click(confirmButton());
  await closed();
  expect(screen.getByText(/^Personal data erased/)).toBeInTheDocument();
  await revokeGrace(user);
  expect(screen.getByText(messages['signatures.notice.revoked'])).toBeInTheDocument();
  expect(screen.queryByText(/^Personal data erased/)).toBeNull();
});

test('an erasure replaces what the revocation said in the live region', async () => {
  serveErase();
  const { user } = await openSignatures('/installations/5/signatures', {
    search: [pageOf([ADA, graceOf()]), pageOf([ADA, GRACE_REVOKED]), pageOf([ADA_ERASED(900), GRACE_REVOKED])],
    revoke: [revokedAs(901)],
  });
  await revokeGrace(user);
  expect(screen.getByText(messages['signatures.notice.revoked'])).toBeInTheDocument();
  await user.click(eraseButton('Ada Lovelace'));
  await user.click(
    await within(await screen.findByRole('alertdialog')).findByRole('button', { name: messages['erase.confirm'] }),
  );
  await closed();
  expect(screen.getByText(/^Personal data erased/)).toBeInTheDocument();
  expect(screen.queryByText(messages['signatures.notice.revoked'])).toBeNull();
});

test('the question can be used with the keyboard alone: Tab walks Cancel and the confirm button, Enter presses one', async () => {
  const { erased, user } = await openErase();
  await user.tab();
  expect(confirmButton()).toHaveFocus();
  await user.tab({ shift: true });
  expect(cancelButton()).toHaveFocus();
  await user.keyboard('{Enter}');
  await closed();
  expect(erased.erase).toEqual([]);
  expect(eraseButton('Ada Lovelace')).toHaveFocus();
});

test('the question passes axe, with its counts', async () => {
  await openErase();
  await expectNoA11yViolations(question());
});
