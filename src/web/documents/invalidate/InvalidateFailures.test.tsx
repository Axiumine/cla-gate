// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { envelope } from '../../api/test-support.ts';
import { messages } from '../../i18n/index.ts';
import { expectNoA11yViolations } from '../../test-support/a11y.ts';
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
  ruleAnswer,
} from './test-support.ts';

// E18-S14: what the invalidation does when the server says no: a count that moved asks for a fresh confirmation, a major with nothing left
// in force is said in the question, a refusal and a failure are shown where they came, and a preview that cannot be had leaves nothing to confirm.

const counts = () =>
  within(question())
    .getAllByRole('definition')
    .map((value) => value.textContent);
const alerts = () =>
  within(question())
    .queryAllByRole('alert')
    .map((alert) => alert.textContent);

test('409 count_changed reads the preview again, shows the new number, withdraws the acknowledgement and asks for a fresh confirmation', async () => {
  const { invalidated, user } = await openQuestion({
    invalidate: {
      preview: [previewOf(7, 2), previewOf(9, 2)],
      invalidate: [ruleAnswer('count_changed'), invalidatedAs(9)],
    },
  });
  await agree(user, 'maintainer_decision');
  await user.click(confirmButton());
  await waitFor(() => {
    expect(counts()).toEqual(['9', '2']);
  });
  expect(alerts()).toEqual([messages['invalidate.countChanged']]);
  expect(invalidated.preview).toHaveLength(2);
  expect(acknowledgement()).toHaveAttribute('aria-checked', 'false');
  expect(acknowledgement()).toHaveAccessibleName(
    'I have seen that 9 signatures of version 1 will stop covering pull requests. (required)',
  );
  expect(reasonSelect()).toHaveValue('maintainer_decision');
  expect(question()).toBeInTheDocument();

  await user.click(confirmButton());
  expect(await within(question()).findByText(messages['invalidate.acknowledge.required'])).toBeInTheDocument();
  expect(invalidated.invalidate).toHaveLength(1);

  await user.click(acknowledgement());
  await user.click(confirmButton());
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  expect(invalidated.invalidate.map((seen) => bodyOf(seen))).toEqual([
    { major: 1, reasonCode: 'maintainer_decision', expectedCount: 7 },
    { major: 1, reasonCode: 'maintainer_decision', expectedCount: 9 },
  ]);
});

test('while the preview is read again after count_changed the question shows the loading state and the confirm button cannot be pressed', async () => {
  const gate = held(previewOf(9));
  const { user } = await openQuestion({
    invalidate: { preview: [previewOf(7), gate.answer], invalidate: [ruleAnswer('count_changed')] },
  });
  await agree(user);
  await user.click(confirmButton());
  expect(await within(question()).findByRole('status', { name: '' })).toHaveTextContent(messages['states.loading']);
  expect(confirmButton()).toBeDisabled();
  gate.release();
  await countsShown();
  await waitFor(() => {
    expect(counts()).toEqual(['9', '2']);
  });
  expect(confirmButton()).toBeEnabled();
});

test('409 nothing_to_invalidate is said in the question, which stays open with nothing left to confirm', async () => {
  const { invalidated, user } = await openQuestion({
    invalidate: { invalidate: [ruleAnswer('nothing_to_invalidate')] },
  });
  await agree(user);
  await user.click(confirmButton());
  expect(await within(question()).findByRole('alert')).toHaveTextContent(
    messages['invalidate.gone'].replace('{major}', '1'),
  );
  expect(confirmButton()).toBeDisabled();
  expect(invalidated.invalidate).toHaveLength(1);
  await expectNoA11yViolations(question());
  await user.click(cancelButton());
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  await user.click(invalidateButton(1));
  await countsShown();
  expect(alerts()).toEqual([]);
  expect(confirmButton()).toBeEnabled();
});

test('403 on the invalidation is shown in the question, with its request id and without "Try again", and a new attempt clears it', async () => {
  const { invalidated, user } = await openQuestion({
    invalidate: { invalidate: [envelope(403, 'forbidden'), invalidatedAs(7)] },
  });
  await agree(user);
  await user.click(confirmButton());
  const alert = await within(question()).findByRole('alert');
  expect(alert).toHaveTextContent(messages['errors.forbidden']);
  expect(within(alert).queryByRole('button', { name: messages['states.retry'] })).toBeNull();
  expect(question()).toBeInTheDocument();
  await user.click(confirmButton());
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  expect(invalidated.invalidate).toHaveLength(2);
});

test('a failure of the server on the invalidation is shown in the question, which stays open, and leaves the numbers as they are', async () => {
  const { user } = await openQuestion({ invalidate: { invalidate: [envelope(503, 'service_unavailable')] } });
  await agree(user);
  await user.click(confirmButton());
  expect(await within(question()).findByRole('alert')).toHaveTextContent(messages['errors.service_unavailable']);
  expect(counts()).toEqual(['7', '2']);
  expect(acknowledgement()).toHaveAttribute('aria-checked', 'true');
});

test.each([
  ['403', envelope(403, 'forbidden'), messages['errors.forbidden'], false],
  [
    "the uniform 404 of a document that is not this tenant's",
    envelope(404, 'not_found'),
    messages['errors.not_found'],
    true,
  ],
])(
  '%s on the preview is shown in the question with nothing to confirm: no counts, no fields, no confirm',
  async (_what, answer, words, retry) => {
    await openQuestion({ invalidate: { preview: [answer] }, countsReady: false });
    const alert = await within(question()).findByRole('alert');
    expect(alert).toHaveTextContent(words);
    expect(within(question()).queryByRole('definition')).toBeNull();
    expect(within(question()).queryByRole('combobox')).toBeNull();
    expect(within(question()).queryByRole('checkbox')).toBeNull();
    expect(confirmButton()).toBeDisabled();
    expect(within(question()).queryByRole('button', { name: messages['states.retry'] }) !== null).toBe(retry);
  },
);

test('a failure of the preview offers "Try again", which asks for the counts again and brings the fields in', async () => {
  const { invalidated, user } = await openQuestion({
    invalidate: { preview: [envelope(503, 'service_unavailable'), previewOf(4, 1)] },
    countsReady: false,
  });
  await user.click(await within(question()).findByRole('button', { name: messages['states.retry'] }));
  await countsShown();
  expect(counts()).toEqual(['4', '1']);
  expect(reasonSelect()).toBeInTheDocument();
  expect(invalidated.preview).toHaveLength(2);
});

test('a preview that is still on its way shows the loading state and a confirm button that cannot be pressed', async () => {
  const gate = held(previewOf(7));
  const { invalidated, user } = await openQuestion({ invalidate: { preview: [gate.answer] }, countsReady: false });
  expect(await within(question()).findByRole('status')).toHaveTextContent(messages['states.loading']);
  expect(confirmButton()).toBeDisabled();
  await user.click(confirmButton());
  expect(invalidated.invalidate).toEqual([]);
  gate.release();
  await countsShown();
  expect(confirmButton()).toBeEnabled();
});

test('a major with no signature in force says so, shows no fields and cannot be confirmed', async () => {
  const { invalidated, user } = await openQuestion({ invalidate: { preview: [previewOf(0, 0)] }, countsReady: false });
  expect(await within(question()).findByRole('status')).toHaveTextContent(
    messages['invalidate.nothing'].replace('{major}', '1'),
  );
  expect(within(question()).queryByRole('combobox')).toBeNull();
  expect(within(question()).queryByRole('checkbox')).toBeNull();
  expect(confirmButton()).toBeDisabled();
  await user.click(confirmButton());
  expect(invalidated.invalidate).toEqual([]);
  expect(invalidated.preview).toHaveLength(1);
  await expectNoA11yViolations(question());
});
