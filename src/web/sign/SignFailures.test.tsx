// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  bodyOf,
  CONTEXT_KEY,
  confirmation,
  consentBox,
  contextOf,
  emailChoice,
  failure,
  nameInput,
  openFilled,
  serveSign,
  signButton,
  signedAnswer,
  signUp,
  TWO_EMAILS,
} from './test-support.ts';

// E18-S01: what the page does when the sign request is refused. A refusal about the typed name or the address is shown on that
// field and the form stays as it was; every other failure is the error state, and the typed values stay then too.

/** The form filled and sent once; the page is left showing what the server answered. */
function sendOnce(answers: Parameters<typeof serveSign>[0], name = 'Ada Lovelace') {
  return signUp(serveSign(answers), undefined, name);
}

test('422 invalid_name is shown on the name field, and everything typed stays', async () => {
  const { container } = await sendOnce({ sign: failure(422, 'invalid_name') });
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(messages['sign.name.invalid']);
  expect(nameInput()).toHaveAccessibleDescription(expect.stringContaining(messages['sign.name.invalid']));
  expect(nameInput()).toHaveAttribute('aria-invalid', 'true');
  expect(nameInput()).toHaveValue('Ada Lovelace');
  expect(consentBox()).toBeChecked();
  expect(emailChoice('ada@example.org')).toBeChecked();
  expect(screen.queryByText(messages['states.error.title'])).toBeNull();
  await expectNoA11yViolations(container);
});

test('422 invalid_name takes focus to the name field', async () => {
  await sendOnce({ sign: failure(422, 'invalid_name') });
  await screen.findByRole('alert');
  await waitFor(() => {
    expect(nameInput()).toHaveFocus();
  });
});

test('422 email_not_verified is shown on the address choice, with the other fields as they were', async () => {
  await sendOnce({ sign: failure(422, 'email_not_verified') });
  const group = screen.getByRole('radiogroup', { name: (name) => name.startsWith(messages['sign.email.label']) });
  await waitFor(() => {
    expect(group).toHaveAttribute('aria-invalid', 'true');
  });
  expect(screen.getByRole('alert')).toHaveTextContent(messages['sign.email.notVerified']);
  expect(nameInput()).toHaveValue('Ada Lovelace');
  expect(nameInput()).not.toHaveAttribute('aria-invalid', 'true');
});

test('422 no_verified_email is shown on the address choice too', async () => {
  await sendOnce({ sign: failure(422, 'no_verified_email') });
  expect(await screen.findByRole('alert')).toHaveTextContent(messages['sign.email.none']);
});

test('after a refusal about the name the person corrects it and signs, and the new name is what is sent', async () => {
  const calls = serveSign({ sign: failure(422, 'invalid_name') });
  const { user } = await signUp(calls, undefined, 'Ada');
  await screen.findByRole('alert');
  serveSign({ sign: signedAnswer(true) });
  await user.clear(nameInput());
  await user.paste('Ada Lovelace');
  await waitFor(() => {
    expect(screen.queryByRole('alert')).toBeNull();
  });
  await user.click(signButton());
  await confirmation();
  expect(calls.sign).toHaveLength(1);
  expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
});

test.each([
  [500, 'internal_server_error', messages['errors.internal_server_error']],
  [409, 'conflict', messages['errors.conflict']],
  [422, 'unprocessable_entity', messages['errors.unprocessable_entity']],
  [404, 'not_found', messages['errors.not_found']],
  [400, 'bad_request', messages['errors.bad_request']],
  [403, 'csrf_invalid', messages['errors.csrf_invalid']],
])('%i %s is the error state with the request id, and the typed values stay', async (status, code, message) => {
  await sendOnce({ sign: failure(status, code) });
  const alert = await screen.findByRole('alert', {}, { timeout: 3000 });
  expect(within(alert).getByText(message)).toBeInTheDocument();
  expect(within(alert).getByText('req-00000001')).toBeInTheDocument();
  expect(nameInput()).toHaveValue('Ada Lovelace');
  expect(consentBox()).toBeChecked();
  expect(emailChoice('ada@example.org')).toBeChecked();
  expect(screen.getByRole('button', { name: messages['sign.submit'] })).toBeEnabled();
});

test.each([
  [422, 'hash_mismatch'],
  [409, 'unsupported_document_kind'],
])(
  '%i %s has no state of its own: the error state says so in general terms, and the typed values stay',
  async (status, code) => {
    await sendOnce({ sign: failure(status, code) });
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(messages['errors.unknown'])).toBeInTheDocument();
    expect(nameInput()).toHaveValue('Ada Lovelace');
  },
);

test('a network failure is the error state, and the form stays', async () => {
  await sendOnce({ sign: HttpResponse.error() });
  expect(await screen.findByText(messages['errors.network'])).toBeInTheDocument();
  expect(nameInput()).toHaveValue('Ada Lovelace');
});

test('an answer that is not the contract is the error state, and the form stays', async () => {
  await sendOnce({ sign: HttpResponse.json({ signature: 'no' }, { status: 201 }) });
  expect(await screen.findByText(messages['errors.contract'])).toBeInTheDocument();
  expect(nameInput()).toHaveValue('Ada Lovelace');
});

test('"Try again" sends the same form again, and the error state goes while it is under way', async () => {
  const calls = serveSign({ sign: failure(500, 'internal_server_error') });
  const { user } = await signUp(calls);
  await screen.findByText(messages['errors.internal_server_error']);
  serveSign({ sign: signedAnswer(true) });
  await user.click(screen.getByRole('button', { name: messages['states.retry'] }));
  await confirmation();
  expect(calls.sign).toHaveLength(1);
  expect(screen.queryByText(messages['errors.internal_server_error'])).toBeNull();
});

test('429 shows the countdown, keeps the form, and enables "Try again" once the wait is over', async () => {
  await sendOnce({ sign: failure(429, 'too_many_requests', { 'retry-after': '2' }) });
  expect(await screen.findByText(messages['errors.too_many_requests'])).toBeInTheDocument();
  expect(screen.getByText('You can try again in 2 seconds.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: messages['states.retry'] })).toBeDisabled();
  expect(nameInput()).toHaveValue('Ada Lovelace');
  await waitFor(
    () => {
      expect(screen.getByRole('button', { name: messages['states.retry'] })).toBeEnabled();
    },
    { timeout: 4000 },
  );
});

test('the refusal never puts the typed name in the page more than where it was typed', async () => {
  await sendOnce({ sign: failure(422, 'invalid_name') }, 'Zzzz Typed Name');
  await screen.findByRole('alert');
  expect(screen.getByRole('alert')).not.toHaveTextContent('Zzzz');
});

test('the text on screen changing under the form withdraws the consent but keeps the name and the address', async () => {
  serveSign({ context: HttpResponse.json(contextOf({ emails: TWO_EMAILS })) });
  const { user, queryClient } = await openFilled();
  await user.click(emailChoice('lovelace@example.net'));
  expect(consentBox()).toBeChecked();
  act(() => {
    queryClient.setQueryData(
      CONTEXT_KEY,
      contextOf({
        emails: TWO_EMAILS,
        version: { ...contextOf().version, id: 32, minor: 2, contentSha256: 'f'.repeat(64) },
      }),
    );
  });
  await waitFor(() => {
    expect(consentBox()).not.toBeChecked();
  });
  expect(nameInput()).toHaveValue('Ada Lovelace');
  expect(emailChoice('lovelace@example.net')).toBeChecked();
  await waitFor(() => {
    expect(signButton()).toBeDisabled();
  });
});

test('a request after the text changed carries the new version and hash, never the old ones', async () => {
  const calls = serveSign();
  const { user, queryClient } = await openFilled();
  act(() => {
    queryClient.setQueryData(
      CONTEXT_KEY,
      contextOf({ version: { ...contextOf().version, id: 32, minor: 2, contentSha256: 'f'.repeat(64) } }),
    );
  });
  await waitFor(() => {
    expect(consentBox()).not.toBeChecked();
  });
  await user.click(consentBox());
  await user.click(signButton());
  await waitFor(() => {
    expect(calls.sign).toHaveLength(1);
  });
  expect(bodyOf(calls.sign)).toMatchObject({ versionId: 32, contentSha256: 'f'.repeat(64) });
});

test('the same text coming again leaves the consent as it is', async () => {
  serveSign();
  const { queryClient } = await openFilled();
  act(() => {
    queryClient.setQueryData(CONTEXT_KEY, contextOf());
  });
  await waitFor(() => {
    expect(signButton()).toBeEnabled();
  });
  expect(consentBox()).toBeChecked();
});
