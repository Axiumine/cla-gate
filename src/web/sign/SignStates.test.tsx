// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import { HOSTILE_NAMES } from '../../shared/hostile-names.ts';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { activeContent } from '../test-support/hostile.ts';
import {
  blockedContext,
  contextOf,
  contextResponse,
  EARLIER_SIGNATURE,
  failure,
  openSignPage,
  pageMain,
  renderSign,
  resignContext,
  serveSign,
} from './test-support.ts';

// E18-S02: the states of the sign page for a person who is logged in. Each is a state of its own with its own heading, message
// and next action; one test per state, driven by MSW, asserts the heading, whether the form is there, and axe.

const SIGNED = { id: 9, major: 2, minor: 0, signedAt: '2026-11-02T09:30:00.000Z' } as const;
const REVOKED = { major: 1, signedAt: '2026-01-01T00:00:00.000Z', revokedAt: '2026-06-15T12:00:00.000Z' } as const;

const alreadySigned = (overrides = {}) => contextResponse({ state: 'already_signed', signature: SIGNED, ...overrides });

/** The form is on the page when its fields are. */
const hasForm = () =>
  screen.queryByRole('textbox', { name: (name) => name.startsWith(messages['sign.name.label']) }) !== null;

test.each([
  ['ready', contextResponse(), messages['sign.form.title'], true],
  ['resign_required', resignContext(), messages['sign.resign.title'], true],
  ['ready after a revocation', contextResponse({ revoked: REVOKED }), messages['sign.revoked.title'], true],
  ['already_signed', alreadySigned(), messages['sign.signed.title'], false],
  ['no_verified_email', blockedContext(), messages['sign.blocked.title'], false],
  ['canSign false with no reason', contextResponse({ canSign: false }), messages['sign.cannot.title'], false],
] as const)('the state %s has its heading, and the form is %s', async (_state, context, title, form) => {
  serveSign({ context });
  const { container } = await openSignPage();
  expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
  expect(hasForm()).toBe(form);
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.getByRole('article', { name: messages['sign.text.label'] })).toBeInTheDocument();
  await expectNoA11yViolations(container);
});

test('no CLA in force (409 no_active_cla): a neutral message as the h1, no form and no text, and no alert or request id', async () => {
  serveSign({ context: failure(409, 'no_active_cla') });
  const { container } = renderSign();
  const heading = await screen.findByRole('heading', { level: 1, name: messages['sign.noCla.title'] });
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(within(pageMain()).getByRole('status')).toHaveTextContent(messages['sign.noCla.message']);
  expect(hasForm()).toBe(false);
  expect(screen.queryByRole('article')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByText('req-00000001')).toBeNull();
  expect(heading).not.toHaveFocus();
  await expectNoA11yViolations(container);
});

test('the state that is there when the page opens does not take focus away from the start of the page', async () => {
  serveSign({ context: resignContext() });
  await openSignPage();
  expect(document.body).toHaveFocus();
});

test('already signed: the version and signing time in UTC, no action needed, and the way to the list of signatures', async () => {
  serveSign({ context: alreadySigned() });
  await openSignPage();
  const notice = within(pageMain()).getByRole('status');
  expect(within(notice).getByRole('heading', { level: 2, name: messages['sign.signed.title'] })).toBeInTheDocument();
  expect(within(notice).getByText('2.0')).toBeInTheDocument();
  expect(within(notice).getByText('2026-11-02 09:30 UTC')).toHaveAttribute('datetime', '2026-11-02T09:30:00.000Z');
  expect(within(notice).getByText(messages['sign.signed.noAction'])).toBeInTheDocument();
  expect(within(notice).getByRole('link', { name: messages['sign.signed.mine'] })).toHaveAttribute(
    'href',
    '/me/signatures',
  );
  expect(within(notice).getByRole('link', { name: messages['sign.done.pullRequest'] })).toHaveAttribute(
    'href',
    'https://github.com/acme/widgets/pull/45',
  );
  expect(within(pageMain()).queryByRole('checkbox')).toBeNull();
  expect(within(pageMain()).queryByRole('button', { name: messages['sign.submit'] })).toBeNull();
  expect(within(pageMain()).queryByRole('radio')).toBeNull();
});

test.each([
  ['there is none', null],
  ['it is not on github.com', 'https://evil.example/acme/widgets/pull/45'],
  ['it is a script', 'javascript:alert(1)'],
])('already signed: no link to the pull request when %s', async (_label, prUrl) => {
  serveSign({ context: alreadySigned({ prUrl }) });
  await openSignPage();
  expect(screen.queryByRole('link', { name: messages['sign.done.pullRequest'] })).toBeNull();
  expect(screen.getByRole('link', { name: messages['sign.signed.mine'] })).toBeInTheDocument();
});

test('already signed without the details of the signature still says that no action is needed', async () => {
  serveSign({ context: alreadySigned({ signature: null }) });
  await openSignPage();
  expect(screen.getByText(messages['sign.signed.noAction'])).toBeInTheDocument();
  expect(screen.queryByText(messages['sign.done.signedAt'])).toBeNull();
});

test('a new major version: the notice names the major signed and the version now in force, with its rationale, and then the form', async () => {
  serveSign({ context: resignContext() });
  await openSignPage();
  const notice = within(pageMain()).getByRole('status');
  expect(
    within(notice).getByText(
      'You signed major version 1. The agreement is now at version 2.1, which needs your signature again.',
    ),
  ).toBeInTheDocument();
  expect(within(notice).getByText(messages['sign.rationale'])).toBeInTheDocument();
  expect(within(notice).getByText('Clarified the patent grant')).toBeInTheDocument();
  expect(hasForm()).toBe(true);
});

test('a new major version without a signature to name says so without a major', async () => {
  serveSign({ context: resignContext({ signature: null }) });
  await openSignPage();
  expect(
    screen.getByText('The agreement is now at version 2.1, which needs your signature again.'),
  ).toBeInTheDocument();
});

test('a new major version with no rationale has no rationale row', async () => {
  serveSign({ context: resignContext({ version: { ...contextOf().version, rationale: '' } }) });
  await openSignPage();
  expect(screen.queryByText(messages['sign.rationale'])).toBeNull();
  expect(hasForm()).toBe(true);
});

test.each(HOSTILE_NAMES)('the rationale %j is text in the notice', async (rationale) => {
  serveSign({ context: resignContext({ version: { ...contextOf().version, rationale } }) });
  await openSignPage();
  expect(within(pageMain()).getByRole('status').textContent).toContain(rationale);
  expect(activeContent(pageMain())).toEqual([]);
});

test('after a revocation: the notice says it applies to future pull requests only, with when, and then the form', async () => {
  serveSign({ context: contextResponse({ revoked: REVOKED }) });
  await openSignPage();
  const notice = within(pageMain()).getByRole('status');
  expect(within(notice).getByText(/applies to future pull requests only/u)).toBeInTheDocument();
  expect(within(notice).getByText('2026-06-15 12:00 UTC')).toHaveAttribute('datetime', '2026-06-15T12:00:00.000Z');
  expect(hasForm()).toBe(true);
});

test('a state without a revocation or a new major has no notice at all', async () => {
  serveSign();
  await openSignPage();
  expect(within(pageMain()).queryByRole('status')).toBeNull();
  expect(hasForm()).toBe(true);
});

test('the earlier signature of a person who must sign again is not mistaken for a revocation', async () => {
  serveSign({ context: resignContext({ revoked: REVOKED }) });
  await openSignPage();
  expect(screen.getByRole('heading', { level: 2, name: messages['sign.resign.title'] })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: messages['sign.revoked.title'] })).toBeNull();
});

test('the notice and the blocked panel of a person who must sign again and has no verified address are both there', async () => {
  serveSign({ context: blockedContext({ state: 'resign_required', signature: EARLIER_SIGNATURE }) });
  await openSignPage();
  expect(screen.getByRole('heading', { level: 2, name: messages['sign.resign.title'] })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: messages['sign.blocked.title'] })).toBeInTheDocument();
  expect(hasForm()).toBe(false);
});

test('a state that is not the happy path is announced as a status, never as an alert', async () => {
  serveSign({ context: alreadySigned() });
  renderSign();
  await screen.findByRole('heading', { level: 2, name: messages['sign.signed.title'] });
  expect(screen.queryByRole('alert')).toBeNull();
});

test.each(['unknown repository', 'tenant suspended on GitHub', 'organisation not admitted by this instance'])(
  'a 404 for the reason %j is the same error state, with the request id and nothing of the reason',
  async (reason) => {
    const body = { error: { code: 'not_found', message: reason, requestId: 'req-00000001' } };
    serveSign({ context: HttpResponse.json(body, { status: 404 }) });
    renderSign();
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { level: 1, name: messages['states.error.title'] })).toBeInTheDocument();
    expect(alert).toHaveTextContent(messages['errors.not_found']);
    expect(alert).toHaveTextContent('req-00000001');
    expect(pageMain().textContent).not.toContain(reason);
    expect(screen.queryByRole('article')).toBeNull();
  },
);

test('a 429 on the context shows the countdown, keeps the retry button off until the wait is over, and shows no form', async () => {
  serveSign({ context: failure(429, 'too_many_requests', { 'retry-after': '2' }) });
  renderSign();
  const alert = await screen.findByRole('alert');
  expect(within(alert).getByRole('heading', { level: 1, name: messages['states.error.title'] })).toBeInTheDocument();
  expect(within(alert).getByText('You can try again in 2 seconds.')).toBeInTheDocument();
  expect(within(alert).getByRole('button', { name: messages['states.retry'] })).toBeDisabled();
  expect(hasForm()).toBe(false);
});
