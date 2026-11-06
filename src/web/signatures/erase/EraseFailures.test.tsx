// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { envelope } from '../../api/test-support.ts';
import { held } from '../../documents/test-support.ts';
import { messages } from '../../i18n/index.ts';
import { expectNoA11yViolations } from '../../test-support/a11y.ts';
import { bodyOf } from '../test-support.ts';
import {
  cancelButton,
  confirmButton,
  countChanged,
  countsShown,
  eraseButton,
  erasedAs,
  nothingHeld,
  openErase,
  previewOf,
  question,
} from './test-support.ts';

// E18-S14: what the erasure does when the server says no: a count that moved asks for a fresh confirmation, a person the installation holds
// nothing of is said in the question, a refusal and a failure are shown where they came, and a preview that cannot be had leaves nothing to confirm.

const closed = () =>
  waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
const listed = () =>
  within(question())
    .getAllByRole('listitem')
    .map((item) => item.textContent);

test('409 count_changed reads the preview again, shows the new numbers and asks for a fresh confirmation, which sends the new count', async () => {
  const { erased, user } = await openErase({
    erase: { preview: [previewOf(2, 2), previewOf(3, 3)], erase: [countChanged(), erasedAs(3)] },
  });
  await user.click(confirmButton());
  expect(await within(question()).findByRole('alert')).toHaveTextContent(messages['erase.countChanged']);
  await waitFor(() => {
    expect(listed()[0]).toContain('(3 records)');
  });
  expect(erased.preview).toHaveLength(2);
  expect(question()).toBeInTheDocument();
  expect(erased.erase).toHaveLength(1);
  await user.click(confirmButton());
  await closed();
  expect(erased.erase.map((seen) => bodyOf(seen))).toEqual([
    { githubUserId: 4711, expectedRows: 2 },
    { githubUserId: 4711, expectedRows: 3 },
  ]);
});

test('while the preview is read again after count_changed the question shows the loading state and the confirm button cannot be pressed', async () => {
  const gate = held(previewOf(3, 3));
  const { user } = await openErase({ erase: { preview: [previewOf(2, 2), gate.answer], erase: [countChanged()] } });
  await user.click(confirmButton());
  expect(await within(question()).findByRole('status')).toHaveTextContent(messages['states.loading']);
  expect(confirmButton()).toBeDisabled();
  gate.release();
  await countsShown();
  expect(confirmButton()).toBeEnabled();
});

test('404 on the preview says that the installation holds nothing of the person: an info message, no lists and nothing to confirm', async () => {
  const { erased, user } = await openErase({ erase: { preview: [nothingHeld()] }, ready: false });
  const note = await within(question()).findByRole('status');
  expect(note).toHaveTextContent(messages['erase.nothing']);
  expect(within(question()).queryByRole('list')).toBeNull();
  expect(within(question()).queryByRole('alert')).toBeNull();
  expect(confirmButton()).toBeDisabled();
  await user.click(confirmButton());
  expect(erased.erase).toEqual([]);
  await expectNoA11yViolations(question());
});

test('404 on the erasure itself, when the person has nothing left here, shows the same info message, keeps the question open and leaves nothing to confirm', async () => {
  const { erased, user } = await openErase({ erase: { erase: [nothingHeld()] } });
  await user.click(confirmButton());
  expect(await within(question()).findByText(messages['erase.nothing'])).toBeInTheDocument();
  expect(confirmButton()).toBeDisabled();
  expect(erased.erase).toHaveLength(1);
  expect(question()).toBeInTheDocument();
  await user.click(cancelButton());
  await closed();
  await user.click(eraseButton('Ada Lovelace'));
  await countsShown();
  expect(within(question()).queryByText(messages['erase.nothing'])).toBeNull();
  expect(confirmButton()).toBeEnabled();
});

test('403 on the erasure is shown in the question, with no "Try again", and a new attempt clears it', async () => {
  const { erased, user } = await openErase({ erase: { erase: [envelope(403, 'forbidden'), erasedAs(2)] } });
  await user.click(confirmButton());
  const alert = await within(question()).findByRole('alert');
  expect(alert).toHaveTextContent(messages['errors.forbidden']);
  expect(within(alert).queryByRole('button', { name: messages['states.retry'] })).toBeNull();
  expect(question()).toBeInTheDocument();
  await user.click(confirmButton());
  await closed();
  expect(erased.erase).toHaveLength(2);
});

test('a failure of the server on the erasure is shown in the question, which stays open with the numbers as they were', async () => {
  const { user } = await openErase({ erase: { erase: [envelope(503, 'service_unavailable')] } });
  await user.click(confirmButton());
  expect(await within(question()).findByRole('alert')).toHaveTextContent(messages['errors.service_unavailable']);
  expect(listed()[0]).toContain('(2 records)');
});

test('403 on the preview is shown in the question with nothing to confirm', async () => {
  await openErase({ erase: { preview: [envelope(403, 'forbidden')] }, ready: false });
  expect(await within(question()).findByRole('alert')).toHaveTextContent(messages['errors.forbidden']);
  expect(within(question()).queryByRole('list')).toBeNull();
  expect(confirmButton()).toBeDisabled();
});

test('a failure of the preview offers "Try again", which asks for the counts again', async () => {
  const { erased, user } = await openErase({
    erase: { preview: [envelope(503, 'service_unavailable'), previewOf(1, 1)] },
    ready: false,
  });
  await user.click(await within(question()).findByRole('button', { name: messages['states.retry'] }));
  await countsShown();
  expect(listed()[0]).toContain('(1 record)');
  expect(erased.preview).toHaveLength(2);
  expect(confirmButton()).toBeEnabled();
});

test('a preview that is still on its way shows the loading state and a confirm button that cannot be pressed', async () => {
  const gate = held(previewOf());
  const { erased, user } = await openErase({ erase: { preview: [gate.answer] }, ready: false });
  expect(await within(question()).findByRole('status')).toHaveTextContent(messages['states.loading']);
  expect(confirmButton()).toBeDisabled();
  await user.click(confirmButton());
  expect(erased.erase).toEqual([]);
  gate.release();
  await countsShown();
  expect(confirmButton()).toBeEnabled();
});
