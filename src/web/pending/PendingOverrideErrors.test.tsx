// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import { envelope } from '../api/test-support.ts';
import { held } from '../documents/test-support.ts';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  cancelAndReopen,
  openPending,
  PENDING_ROUTE,
  pageOf,
  pendingOf,
  reasonField,
  recordButton,
  recordDialog,
  recordedAs,
  rule,
  submitButton,
  UNLINKED_SHA,
} from './test-support.ts';

// E18-S08: what a record that is refused does. The five rules of the API with words of their own are alerts in the dialog, which stays
// open with the typed reason; the field rules are put under the field; anything else is the error state, with the countdown for a limit.

const SHORT = UNLINKED_SHA.slice(0, 7);
const REASON = 'Work email of a maintainer';

async function attempt(serve: Parameters<typeof openPending>[1]) {
  const opened = await openPending(PENDING_ROUTE, serve);
  await opened.user.click(recordButton(SHORT));
  await screen.findByRole('dialog');
  await opened.user.type(reasonField(), REASON);
  await opened.user.click(submitButton());
  return opened;
}

const alertOf = () => within(recordDialog()).findByRole('alert');

test.each([
  ['422 commit_not_found', 422, 'commit_not_found', messages['pending.rule.commit_not_found']],
  ['409 override_exists', 409, 'override_exists', messages['pending.rule.override_exists']],
  ['409 repository_disabled', 409, 'repository_disabled', messages['pending.rule.repository_disabled']],
  ['409 installation_suspended', 409, 'installation_suspended', messages['pending.rule.installation_suspended']],
])(
  '%s is told in the words of the catalog, the dialog stays open, the reason stays, and the list is not asked for again',
  async (_what, status, code, text) => {
    const { served } = await attempt({ record: [rule(status, code)] });
    expect(await alertOf()).toHaveTextContent(text);
    expect(recordDialog()).toBeInTheDocument();
    expect(reasonField()).toHaveValue(REASON);
    expect(served.pending).toHaveLength(1);
    expect(screen.queryByText(messages['pending.notice.recorded'])).toBeNull();
  },
);

test.each([
  ['a 409 with the code of a 422 rule', 409, 'commit_not_found'],
  ['a 422 with the code of a 409 rule', 422, 'override_exists'],
  ['a 409 with the code of an installation that is gone', 409, 'installation_deleted'],
])('%s is no rule of the dialog: it is the general error state', async (_what, status, code) => {
  await attempt({ record: [rule(status, code)] });
  expect(await alertOf()).toHaveTextContent(messages['errors.unknown']);
});

test('422 invalid_reason is put under the reason field, which is marked invalid, and editing the reason takes it away', async () => {
  const { user } = await attempt({ record: [rule(422, 'invalid_reason')] });
  await waitFor(() => {
    expect(reasonField()).toBeInvalid();
  });
  expect(await alertOf()).toHaveTextContent(messages['pending.override.reason.invalid']);
  await user.type(reasonField(), '!');
  expect(reasonField()).toBeValid();
  expect(within(recordDialog()).queryByRole('alert')).toBeNull();
});

test('422 invalid_commit_sha is put under the commit field, and nothing else is shown for it', async () => {
  await attempt({ record: [rule(422, 'invalid_commit_sha')] });
  expect(await alertOf()).toHaveTextContent(messages['pending.override.sha.invalid']);
  expect(within(recordDialog()).getAllByRole('alert')).toHaveLength(1);
});

test.each([
  ['502', 502, 'github_unavailable', messages['errors.github_unavailable']],
  ['500', 500, 'internal_server_error', messages['errors.internal_server_error']],
  ['400', 400, 'bad_request', messages['errors.bad_request']],
  ['404', 404, 'not_found', messages['errors.not_found']],
])('%s is the error state in the dialog, which stays open and keeps the reason', async (_what, status, code, text) => {
  const { served } = await attempt({ record: [envelope(status, code)] });
  expect(await alertOf()).toHaveTextContent(text);
  expect(reasonField()).toHaveValue(REASON);
  expect(served.pending).toHaveLength(1);
  expect(recordDialog()).toBeInTheDocument();
});

test('403 is the forbidden state in the dialog with no Try again, because asking again changes nothing', async () => {
  await attempt({ record: [rule(403, 'forbidden')] });
  const alert = await alertOf();
  expect(alert).toHaveTextContent(messages['errors.forbidden']);
  expect(within(alert).queryByRole('button', { name: messages['states.retry'] })).toBeNull();
});

test('503 with a wait shows the countdown, and Try again is off until it is over', async () => {
  await attempt({ record: [envelope(503, 'github_rate_limited', { 'retry-after': '30' })] });
  const alert = await alertOf();
  expect(alert).toHaveTextContent(messages['errors.github_rate_limited']);
  expect(within(alert).getByRole('button', { name: messages['states.retry'] })).toBeDisabled();
  expect(within(alert).getByText(messages['states.retryIn.other'].replace('{count}', '30'))).toBeInTheDocument();
});

test('a network failure is the network error in the dialog', async () => {
  await attempt({ record: [() => HttpResponse.error()] });
  expect(await alertOf()).toHaveTextContent(messages['errors.network']);
});

async function retry(user: UserEvent) {
  const alert = await alertOf();
  await user.click(within(alert).getByRole('button', { name: messages['states.retry'] }));
}

test('Try again after a 502 sends the same override, and on success the dialog closes and the list is asked for again', async () => {
  const { served, user } = await attempt({
    pending: [pageOf([pendingOf()]), pageOf([pendingOf()])],
    record: [envelope(502, 'github_unavailable'), recordedAs()],
  });
  await retry(user);
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(served.record).toHaveLength(2);
  expect(JSON.parse(String(served.record[1]?.text))).toEqual({ commitSha: UNLINKED_SHA, reason: REASON });
  expect(served.pending).toHaveLength(2);
});

test('a new attempt with the reason edited takes the error away first, and the dialog opened again starts empty', async () => {
  const { user } = await attempt({ record: [rule(409, 'override_exists')] });
  await alertOf();
  await user.type(reasonField(), ' again');
  expect(within(recordDialog()).queryByRole('alert')).toBeNull();
  await cancelAndReopen(user, SHORT);
  expect(within(recordDialog()).queryByRole('alert')).toBeNull();
  expect(reasonField()).toHaveValue('');
});

test('the dialog with a refusal passes axe', async () => {
  await attempt({ record: [rule(422, 'commit_not_found')] });
  await alertOf();
  await expectNoA11yViolations(document.body);
});

test('a reason edited while the request is out does not lock the dialog: the next submit is sent, and the answer to the first one is dropped', async () => {
  const gate = held(rule(409, 'override_exists'));
  const opened = await openPending(PENDING_ROUTE, { record: [gate.answer, recordedAs()] });
  await opened.user.click(recordButton(SHORT));
  await screen.findByRole('dialog');
  await opened.user.type(reasonField(), REASON);
  await opened.user.click(submitButton());
  await waitFor(() => {
    expect(opened.served.record).toHaveLength(1);
  });
  await opened.user.type(reasonField(), '!');
  gate.release();
  await waitFor(() => {
    expect(submitButton()).not.toHaveAttribute('aria-busy', 'true');
  });
  expect(within(recordDialog()).queryByRole('alert')).toBeNull();
  await opened.user.click(submitButton());
  await screen.findByText(messages['pending.notice.recorded']);
  expect(opened.served.record).toHaveLength(2);
});
