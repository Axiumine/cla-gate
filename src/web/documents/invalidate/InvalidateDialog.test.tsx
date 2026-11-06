// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { messages } from '../../i18n/index.ts';
import { expectNoA11yViolations } from '../../test-support/a11y.ts';
import { expectRevokeReasonChoices } from '../../test-support/revoke-reasons.ts';
import { HISTORY, openHistory, pageOf, versionsTable } from '../history/test-support.ts';
import { bodyOf, held } from '../test-support.ts';
import {
  acknowledgement,
  agree,
  cancelButton,
  confirmButton,
  countsShown,
  invalidateButton,
  invalidatedAs,
  openQuestion,
  previewOf,
  question,
  reasonSelect,
} from './test-support.ts';

// E18-S14: invalidating the signatures of a major: a question that shows the counts the server made, asks for a reason and for the
// acknowledgement of the count, and sends one request to the installation and the document of the address.

const closed = () =>
  waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

test('the first version of each major has "Invalidate signatures" that names the major, and the other versions have none', async () => {
  await openHistory();
  expect(invalidateButton(1)).toHaveTextContent(messages['invalidate.action']);
  const labels = within(versionsTable())
    .getAllByRole('button', { name: /^Invalidate signatures of version/ })
    .map((button) => button.getAttribute('aria-label'));
  expect(labels).toEqual(['Invalidate signatures of version 2', 'Invalidate signatures of version 1']);
});

test('the question names the major and the document, says what it does and cannot be undone, and starts on Cancel', async () => {
  await openQuestion();
  expect(question()).toHaveAccessibleName(`${messages['invalidate.title'].replace('{major}', '1')} Individual CLA`);
  expect(question()).toHaveAccessibleDescription(messages['invalidate.description']);
  expect(question()).toHaveTextContent('This cannot be undone.');
  expect(cancelButton()).toHaveFocus();
});

test('it shows the counts of the preview, asked of the document and the installation of the address, and nothing about any person', async () => {
  const { invalidated } = await openQuestion({ invalidate: { preview: [previewOf(1234, 3, 1)] } });
  expect(
    within(question())
      .getAllByRole('term')
      .map((term) => term.textContent),
  ).toEqual([messages['invalidate.preview.activeSignatures'], messages['invalidate.preview.affectedRepositories']]);
  expect(
    within(question())
      .getAllByRole('definition')
      .map((value) => value.textContent),
  ).toEqual(['1,234', '3']);
  expect(invalidated.preview.map((seen) => new URL(seen.url).pathname + new URL(seen.url).search)).toEqual([
    '/api/installations/5/documents/11/invalidation-preview?major=1',
  ]);
  expect(question().textContent).not.toMatch(/octocat|zzzz|@/);
});

test('the preview is asked for the major of the row, and again every time the question opens', async () => {
  const { invalidated, user } = await openQuestion({ major: 2 });
  expect(invalidated.preview.map((seen) => new URL(seen.url).searchParams.get('major'))).toEqual(['2']);
  await user.click(cancelButton());
  await closed();
  await user.click(invalidateButton(2));
  await countsShown();
  expect(invalidated.preview).toHaveLength(2);
});

test('the reason is a required choice of the four codes in the words of the catalog, with no free-text field, and the acknowledgement says how many', async () => {
  await openQuestion({ invalidate: { preview: [previewOf(7)] } });
  expectRevokeReasonChoices(reasonSelect());
  expect(within(question()).queryByRole('textbox')).toBeNull();
  expect(acknowledgement()).toHaveAttribute('aria-required', 'true');
  expect(acknowledgement()).toHaveAccessibleName(
    'I have seen that 7 signatures of version 1 will stop covering pull requests. (required)',
  );
});

test('one signature is said in the singular', async () => {
  await openQuestion({ invalidate: { preview: [previewOf(1)] } });
  expect(acknowledgement()).toHaveAccessibleName(
    'I have seen that 1 signature of version 1 will stop covering pull requests. (required)',
  );
});

test('confirming with neither the reason nor the acknowledgement sends nothing, keeps the question open and says what is missing; each goes away when it is given', async () => {
  const { invalidated, user } = await openQuestion();
  await user.click(confirmButton());
  expect(await within(question()).findAllByRole('alert')).toHaveLength(2);
  expect(reasonSelect()).toHaveAttribute('aria-invalid', 'true');
  expect(acknowledgement()).toHaveAttribute('aria-invalid', 'true');
  expect(within(question()).getByText(messages['signatures.revoke.reason.required'])).toBeInTheDocument();
  expect(within(question()).getByText(messages['invalidate.acknowledge.required'])).toBeInTheDocument();
  expect(invalidated.invalidate).toEqual([]);
  await user.selectOptions(reasonSelect(), 'other');
  expect(within(question()).queryByText(messages['signatures.revoke.reason.required'])).toBeNull();
  expect(within(question()).getByText(messages['invalidate.acknowledge.required'])).toBeInTheDocument();
  await user.click(acknowledgement());
  expect(within(question()).queryByRole('alert')).toBeNull();
  expect(question()).toBeInTheDocument();
});

test('a reason without the acknowledgement, and the acknowledgement without a reason, send nothing either', async () => {
  const { invalidated, user } = await openQuestion();
  await user.selectOptions(reasonSelect(), 'other');
  await user.click(confirmButton());
  expect(await within(question()).findByText(messages['invalidate.acknowledge.required'])).toBeInTheDocument();
  await user.selectOptions(reasonSelect(), '');
  await user.click(acknowledgement());
  await user.click(confirmButton());
  expect(await within(question()).findByText(messages['signatures.revoke.reason.required'])).toBeInTheDocument();
  expect(invalidated.invalidate).toEqual([]);
});

test('Escape cancels the question with no request, as Cancel does, and focus returns to the button that opened it', async () => {
  const { invalidated, user } = await openQuestion();
  await user.keyboard('{Escape}');
  await closed();
  expect(invalidated.invalidate).toEqual([]);
  expect(invalidateButton(1)).toHaveFocus();
  await user.click(invalidateButton(1));
  await countsShown();
  await user.click(cancelButton());
  await closed();
  expect(invalidated.invalidate).toEqual([]);
  expect(invalidateButton(1)).toHaveFocus();
});

test('opening the question again forgets the reason and the acknowledgement of the time before', async () => {
  const { user } = await openQuestion();
  await agree(user);
  await user.click(cancelButton());
  await closed();
  await user.click(invalidateButton(1));
  await countsShown();
  expect(reasonSelect()).toHaveValue('');
  expect(acknowledgement()).toHaveAttribute('aria-checked', 'false');
});

test('confirming sends one POST with the major, the reason code and the count that was seen, and nothing else, to the document of the address', async () => {
  const { invalidated, user } = await openQuestion({ invalidate: { preview: [previewOf(7)] } });
  await agree(user, 'legal_request');
  await user.click(confirmButton());
  await closed();
  expect(invalidated.invalidate.map((seen) => [seen.method, new URL(seen.url).pathname])).toEqual([
    ['POST', '/api/installations/5/documents/11/invalidations'],
  ]);
  expect(bodyOf(invalidated.invalidate[0])).toEqual({ major: 1, reasonCode: 'legal_request', expectedCount: 7 });
  expect(invalidated.invalidate[0]?.headers['x-csrf-token']).toBeTruthy();
});

test('it is not optimistic: the question stays open and busy until the server answers, a double click is one request, and neither Cancel nor Escape closes it meanwhile', async () => {
  const gate = held(invalidatedAs(7));
  const { invalidated, user } = await openQuestion({ invalidate: { invalidate: [gate.answer] } });
  await agree(user);
  await user.dblClick(confirmButton());
  expect(confirmButton()).toHaveAttribute('aria-busy', 'true');
  await user.click(cancelButton());
  await user.keyboard('{Escape}');
  expect(question()).toBeInTheDocument();
  expect(invalidated.invalidate).toHaveLength(1);
  gate.release();
  await closed();
  expect(invalidated.invalidate).toHaveLength(1);
});

test('on success the question closes, the live region says how many signatures were invalidated, the versions and signatures are asked for again, and focus returns to the button', async () => {
  const { invalidated, queryClient, served, user } = await openQuestion({
    invalidate: { invalidate: [invalidatedAs(7)] },
    history: { list: [pageOf(HISTORY)] },
  });
  const spy = vi.spyOn(queryClient, 'invalidateQueries');
  await agree(user);
  await user.click(confirmButton());
  await closed();
  expect(
    screen
      .getByText(
        '7 signatures of version 1 were invalidated. Pull requests of the repositories that use this document are checked again.',
      )
      .closest('[role="status"]'),
  ).toHaveAttribute('aria-live', 'polite');
  expect(spy).toHaveBeenCalledWith({ queryKey: ['installation', 5, 'signatures'] });
  expect(served.list).toHaveLength(2);
  expect(invalidated.invalidate).toHaveLength(1);
  await waitFor(() => {
    expect(invalidateButton(1)).toHaveFocus();
  });
});

test('one invalidated signature is said in the singular, with the major of the row', async () => {
  const { user } = await openQuestion({
    major: 2,
    invalidate: { preview: [previewOf(1, 1, 2)], invalidate: [invalidatedAs(1)] },
  });
  await agree(user);
  await user.click(confirmButton());
  await closed();
  expect(
    screen.getByText(
      '1 signature of version 2 was invalidated. Pull requests of the repositories that use this document are checked again.',
    ),
  ).toBeInTheDocument();
});

test('the question can be used with the keyboard alone: Tab and Shift+Tab walk its controls, Space ticks the acknowledgement, Enter presses a button', async () => {
  const { invalidated, user } = await openQuestion();
  await user.tab({ shift: true });
  expect(acknowledgement()).toHaveFocus();
  await user.keyboard(' ');
  expect(acknowledgement()).toHaveAttribute('aria-checked', 'true');
  await user.tab({ shift: true });
  expect(reasonSelect()).toHaveFocus();
  await user.tab();
  await user.tab();
  expect(cancelButton()).toHaveFocus();
  await user.tab();
  expect(confirmButton()).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(await within(question()).findByText(messages['signatures.revoke.reason.required'])).toBeInTheDocument();
  expect(invalidated.invalidate).toEqual([]);
  await user.tab({ shift: true });
  await user.keyboard('{Enter}');
  await closed();
  expect(invalidateButton(1)).toHaveFocus();
});

test('the question passes axe, with its fields and with a field in error', async () => {
  const { user } = await openQuestion();
  await expectNoA11yViolations(question());
  await user.click(confirmButton());
  await within(question()).findAllByRole('alert');
  await expectNoA11yViolations(question());
});
