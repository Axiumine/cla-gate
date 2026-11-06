// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { delay, HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import { messages } from '../i18n/index.ts';
import { summary, tenantOf } from '../installations/test-support.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { watchDefault } from '../test-support/default-prevented.ts';
import {
  bodyOf,
  cancelAndReopen,
  gadgetsOf,
  openPending,
  pageOf,
  pathOf,
  pendingOf,
  reasonField,
  recordButton,
  recordDialog,
  recordedAs,
  submitButton,
  UNLINKED_SHA,
  unlinked,
} from './test-support.ts';

// E18-S08: "Record override" on an unlinked identity: the dialog with the repository and the commit prefilled and read-only, the required
// reason, the sentence, the request addressed to the repository of the row, and the dialog that closes only on success.

const SHORT = UNLINKED_SHA.slice(0, 7);
const open = async (serve: Parameters<typeof openPending>[1] = {}) => {
  const opened = await openPending('/installations/5/pending', serve);
  await opened.user.click(recordButton(SHORT));
  await screen.findByRole('dialog', { name: messages['pending.override.title'] });
  return opened;
};

test('the dialog opens with the repository and the full commit id filled in and read-only, a required reason, and the sentence of the contract', async () => {
  await open();
  const dialog = recordDialog();
  const repository = within(dialog).getByRole('textbox', { name: messages['pending.override.repository'] });
  const commit = within(dialog).getByRole('textbox', {
    name: (name) => name.startsWith(messages['pending.override.commit']),
  });
  expect(repository).toHaveValue('acme/widgets');
  expect(repository).toHaveAttribute('readonly');
  expect(commit).toHaveValue(UNLINKED_SHA);
  expect(commit).toHaveAttribute('readonly');
  expect(commit).toHaveAccessibleDescription(messages['pending.override.commit.help']);
  expect(reasonField()).toBeRequired();
  expect(reasonField()).toHaveValue('');
  expect(
    within(dialog).getByText('This allows the commit without implying a signature and is written to the audit log.'),
  ).toBeInTheDocument();
  expect(dialog).toHaveAccessibleDescription(messages['pending.override.description']);
});

test('focus moves into the dialog, Tab stays inside it, and Escape closes it and puts focus back on the button', async () => {
  const { user } = await open();
  const dialog = recordDialog();
  expect(dialog.contains(document.activeElement)).toBe(true);
  for (let step = 0; step < 8; step += 1) {
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  }
  await user.keyboard('{Escape}');
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(recordButton(SHORT)).toHaveFocus();
});

test('the dialog can be completed with the keyboard alone: the reason, Tab to Cancel and to the record button, Enter', async () => {
  const { served, user } = await open();
  await user.type(reasonField(), 'Work email of a maintainer');
  await user.tab();
  expect(within(recordDialog()).getByRole('button', { name: messages['common.cancel'] })).toHaveFocus();
  await user.tab();
  expect(submitButton()).toHaveFocus();
  await user.keyboard('{Enter}');
  await waitFor(() => {
    expect(served.record).toHaveLength(1);
  });
});

test.each([
  ['nothing', ''],
  ['blanks', '   \n\t '],
  ['more than 2000 characters', 'a'.repeat(2001)],
  ['a control character', 'a\u0007b'],
])('a reason of %s is refused in the field, and no request is sent', async (_what, text) => {
  const { served, user } = await open();
  if (text !== '') {
    await user.click(reasonField());
    await user.paste(text);
  }
  await user.click(submitButton());
  expect(await within(recordDialog()).findByText(messages['pending.override.reason.invalid'])).toBeInTheDocument();
  expect(reasonField()).toBeInvalid();
  expect(served.record).toEqual([]);
});

test('the field error goes when the reason is made valid', async () => {
  const { user } = await open();
  await user.click(submitButton());
  await within(recordDialog()).findByText(messages['pending.override.reason.invalid']);
  await user.type(reasonField(), 'Fine');
  expect(within(recordDialog()).queryByText(messages['pending.override.reason.invalid'])).toBeNull();
});

test('a reason of 2000 characters, with blanks around it, is trimmed and goes', async () => {
  const { served, user } = await open();
  await user.click(reasonField());
  await user.paste(`  ${'a'.repeat(2000)}\n`);
  await user.click(submitButton());
  await waitFor(() => {
    expect(served.record).toHaveLength(1);
  });
  expect(bodyOf(served.record[0])).toEqual({ commitSha: UNLINKED_SHA, reason: 'a'.repeat(2000) });
});

test('confirming sends the trimmed reason and the commit to the repository of the row, with the CSRF header, then asks for the list again and closes', async () => {
  const watch = watchDefault('submit');
  const { served, user } = await open({
    pending: [pageOf([pendingOf()]), pageOf([pendingOf({ reasons: [{ code: 'no_active_cla' }] })])],
  });
  await user.type(reasonField(), '  Work email of a maintainer \n');
  await user.click(submitButton());
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(served.record.map(pathOf)).toEqual(['/api/repositories/1/commit-overrides']);
  expect(bodyOf(served.record[0])).toEqual({ commitSha: UNLINKED_SHA, reason: 'Work email of a maintainer' });
  expect(served.record[0]?.headers['x-csrf-token']).toBeTruthy();
  expect(served.pending).toHaveLength(2);
  expect(screen.getByText(messages['pending.notice.recorded'])).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Record override/ })).toBeNull();
  expect(watch.prevented).toEqual([true]);
});

test('when the pull request leaves the list with its button, focus goes to the results heading', async () => {
  const { user } = await open({
    pending: [pageOf([pendingOf()]), pageOf([gadgetsOf()])],
  });
  await user.type(reasonField(), 'Work email');
  await user.click(submitButton());
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  await waitFor(() => {
    expect(screen.getByRole('heading', { level: 2, name: messages['pending.results.title'] })).toHaveFocus();
  });
});

test('when the row stays, focus returns to its button', async () => {
  const { user } = await open();
  await user.type(reasonField(), 'Work email');
  await user.click(submitButton());
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  await waitFor(() => {
    expect(recordButton(SHORT)).toHaveFocus();
  });
});

test('the dialog stays open while the request is out, the button is busy, and a second submit sends no second request', async () => {
  const { served, user } = await open({
    record: [
      async () => {
        await delay(60);
        return recordedAs();
      },
    ],
  });
  await user.type(reasonField(), 'Work email');
  await user.click(submitButton());
  await user.click(submitButton());
  expect(submitButton()).toHaveAttribute('aria-busy', 'true');
  expect(recordDialog()).toBeInTheDocument();
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(served.record).toHaveLength(1);
});

test('the dialog is made for the repository of its own row: the second repository is addressed by its own id', async () => {
  const { served, user } = await openPending('/installations/5/pending', {
    pending: [pageOf([pendingOf(), gadgetsOf({ reasons: [unlinked('c'.repeat(40))] })])],
  });
  await user.click(recordButton('ccccccc', 'acme/gadgets'));
  await screen.findByRole('dialog');
  expect(within(recordDialog()).getByRole('textbox', { name: messages['pending.override.repository'] })).toHaveValue(
    'acme/gadgets',
  );
  await user.type(reasonField(), 'Bot email');
  await user.click(submitButton());
  await waitFor(() => {
    expect(served.record).toHaveLength(1);
  });
  expect(served.record.map(pathOf)).toEqual(['/api/repositories/2/commit-overrides']);
  expect(bodyOf(served.record[0])).toEqual({ commitSha: 'c'.repeat(40), reason: 'Bot email' });
});

test('Cancel closes the dialog with no request, and the dialog opened again starts empty', async () => {
  const { served, user } = await open();
  await user.type(reasonField(), 'Typed and abandoned');
  await cancelAndReopen(user, SHORT);
  expect(reasonField()).toHaveValue('');
  expect(served.record).toEqual([]);
});

test('on a suspended installation the button is off and the dialog cannot be opened', async () => {
  await openPending('/installations/5/pending', {
    tenants: [tenantOf(summary({ suspended: true }), 'acme/widgets', 'acme/gadgets')],
  });
  expect(recordButton(SHORT)).toBeDisabled();
});

test('the dialog passes axe, empty and with its field error', async () => {
  const { user } = await open();
  await expectNoA11yViolations(document.body);
  await user.click(submitButton());
  await within(recordDialog()).findByText(messages['pending.override.reason.invalid']);
  await expectNoA11yViolations(document.body);
});

test('a keyboard user can open the dialog from the list with Enter on the button', async () => {
  const { user } = await openPending('/installations/5/pending');
  recordButton(SHORT).focus();
  await user.keyboard('{Enter}');
  expect(await screen.findByRole('dialog', { name: messages['pending.override.title'] })).toBeInTheDocument();
});

test('an answer that does not match the contract is the contract error in the dialog, which stays open', async () => {
  const { user } = await open({ record: [HttpResponse.json({ override: { id: 1 } }, { status: 201 })] });
  await user.type(reasonField(), 'Work email');
  await user.click(submitButton());
  expect(await within(recordDialog()).findByRole('alert')).toHaveTextContent(messages['errors.contract']);
  expect(recordDialog()).toBeInTheDocument();
});
