// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import {
  answerAvailability,
  answerClaim,
  availabilitySettled,
  claimBox,
  claimButton,
  recordAvailability,
} from '../corporate/test-support.ts';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { CSRF_TOKEN } from '../test-support/session.ts';
import {
  blockedContext,
  consentBox,
  contextResponse,
  openSignPage,
  resignContext,
  serveSign,
  signThrough,
  tabTo,
} from './test-support.ts';

// E21-S04: the entry "Contributing for an employer?" on the page where a contributor signs. It is there only when the repository offers
// the claim of an employee, under the form, and it is asked for the repository of the sign context.

const SIGNED = { id: 9, major: 2, minor: 0, signedAt: '2026-11-02T09:30:00.000Z' } as const;

const entry = () => screen.findByRole('heading', { level: 2, name: messages['corporate.claim.title'] });
const entryNow = () => screen.queryByRole('heading', { name: messages['corporate.claim.title'] });

test('the entry stands under the consent form when the repository offers it, with the claim of the repository of the context', async () => {
  serveSign({
    context: contextResponse({ repository: { githubRepoId: 777, fullName: 'acme/widgets', accountLogin: 'acme' } }),
  });
  const asked = recordAvailability(true);
  await openSignPage('/sign/123?pr=45');
  const heading = await entry();
  // The id is the one the server put in the context, not the one of the address.
  expect(asked).toEqual([777]);
  expect(screen.getByRole('main')).toContainElement(heading);
  expect(screen.getByText(messages['corporate.claim.intro'])).toBeInTheDocument();
  expect(consentBox().compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
});

test.each([
  ['it does not', false],
  ['asking fails', { status: 500, code: 'internal_server_error' }],
] as const)('the page shows no trace of the entry when the repository %s offer it', async (_why, answer) => {
  serveSign();
  answerAvailability(answer);
  const { queryClient } = await openSignPage();
  await availabilitySettled(queryClient);
  expect(entryNow()).toBeNull();
  expect(screen.queryByRole('button', { name: messages['corporate.claim.submit'] })).toBeNull();
  expect(screen.queryByText(messages['corporate.claim.intro'])).toBeNull();
  expect(consentBox()).toBeInTheDocument();
});

test('a person who signed already has no use for the entry, and the repository is not even asked', async () => {
  serveSign({ context: contextResponse({ state: 'already_signed', signature: SIGNED }) });
  const asked = recordAvailability(true);
  await openSignPage();
  await screen.findByRole('heading', { level: 2, name: messages['sign.signed.title'] });
  expect(asked).toEqual([]);
  expect(entryNow()).toBeNull();
});

test.each([
  ['must sign a new major version', resignContext()],
  ['has no verified address', blockedContext()],
])('a person who %s is offered the entry', async (_who, context) => {
  serveSign({ context });
  recordAvailability(true);
  await openSignPage();
  expect(await entry()).toBeInTheDocument();
});

test('the claim from the sign page sends the confirmation and the CSRF token, says "Covered by a corporate CLA" and names no company', async () => {
  const calls = serveSign();
  answerAvailability(true);
  const posted = answerClaim('covered');
  const { user } = await openSignPage();
  await entry();
  await user.click(claimBox());
  await user.click(claimButton());
  const done = await screen.findByText(messages['corporate.claim.done']);
  expect(done).toBeInTheDocument();
  expect(posted).toEqual([{ csrf: CSRF_TOKEN, body: { confirm: true } }]);
  expect(calls.sign).toEqual([]);
  expect(done.textContent).toBe('Covered by a corporate CLA');
  expect(within(screen.getByRole('main')).queryByText(/acme corp/i)).toBeNull();
});

test('a person who signs for themselves is shown the confirmation, and the entry goes with the form', async () => {
  serveSign();
  answerAvailability(true);
  await signThrough();
  expect(entryNow()).toBeNull();
});

test('the page with the entry passes axe, before the claim and after it', async () => {
  serveSign();
  answerAvailability(true);
  answerClaim('already_covered');
  const { container, user } = await openSignPage();
  await entry();
  await expectNoA11yViolations(container);
  await user.click(claimBox());
  await user.click(claimButton());
  await screen.findByText(messages['corporate.claim.done']);
  await expectNoA11yViolations(container);
});

test('the keyboard reaches the box of the entry and then its button, and Space and Enter claim', async () => {
  serveSign();
  answerAvailability(true);
  const posted = answerClaim('covered');
  const { user } = await openSignPage();
  await entry();
  await tabTo(user, claimBox());
  await user.keyboard(' ');
  expect(claimBox()).toBeChecked();
  await tabTo(user, claimButton());
  await user.keyboard('{Enter}');
  expect(await screen.findByText(messages['corporate.claim.done'])).toBeInTheDocument();
  expect(posted).toEqual([{ csrf: CSRF_TOKEN, body: { confirm: true } }]);
});
