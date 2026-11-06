// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { signRoute } from '../../shared/sign.ts';
import { signContextRoute } from '../../shared/sign-context.ts';
import { answer, json } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  bodyOf,
  consentBox,
  contextOf,
  contextResponse,
  emailChoice,
  failure,
  NEWER_SHA,
  nameInput,
  newerVersion,
  openFilled,
  pageMain,
  SHA,
  serveHeldContext,
  serveSign,
  signButton,
  signedAnswer,
} from './test-support.ts';

// E18-S02: the text changed while the person read. A 409 stale_version or stale_consent on submit keeps the typed name, clears
// the consent box, and shows a banner; "Review the new version" loads the version in force. No request is ever sent with the
// old hash, and the consent has to be given again.

afterEach(() => {
  vi.restoreAllMocks();
});

const NEWER = () => json(contextOf({ version: newerVersion() }));

/** The page filled in and sent once; the server refuses it with `code`, and answers the context with `next` the second time. */
async function refusedOnce(code: string, ...next: Response[]) {
  const calls = serveSign();
  const sign = answer(signRoute.path, failure(409, code), signedAnswer(true));
  const contexts = answer(signContextRoute.path, contextResponse(), ...next);
  const opened = await openFilled();
  await opened.user.click(signButton());
  const banner = await screen.findByRole('heading', { level: 3, name: messages['sign.stale.title'] });
  return { ...opened, calls: { ...calls, sign }, contexts, banner };
}

const reviewButton = () => screen.getByRole('button', { name: messages['sign.stale.review'] });

test.each(['stale_version', 'stale_consent'])(
  '409 %s shows the banner as an alert whose heading has focus, keeps the typed name, and clears the consent box',
  async (code) => {
    const { banner } = await refusedOnce(code);
    const alert = banner.closest('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert).toHaveTextContent(messages['sign.stale.message']);
    expect(banner).toHaveFocus();
    expect(nameInput()).toHaveValue('Ada Lovelace');
    expect(consentBox()).not.toBeChecked();
    expect(emailChoice('ada@example.org')).toBeChecked();
    expect(signButton()).toBeDisabled();
    expect(reviewButton()).toBeEnabled();
  },
);

test('the stale banner is not the general error state: no request id, no "Try again"', async () => {
  await refusedOnce('stale_version');
  expect(screen.queryByText(messages['states.error.title'])).toBeNull();
  expect(screen.queryByText('req-00000001')).toBeNull();
  expect(screen.queryByRole('button', { name: messages['states.retry'] })).toBeNull();
});

test('after a stale response no request is ever sent with the old hash, whatever the person presses', async () => {
  const { user, calls } = await refusedOnce('stale_version', NEWER());
  expect(calls.sign).toHaveLength(1);
  await user.click(consentBox());
  expect(consentBox()).toBeChecked();
  expect(signButton()).toBeDisabled();
  nameInput().focus();
  await user.keyboard('{Enter}');
  fireEvent.submit(nameInput());
  await user.click(signButton());
  expect(calls.sign).toHaveLength(1);
});

test('"Review the new version" loads the version in force, removes the banner, scrolls to the top and focuses the title', async () => {
  const scroll = vi.spyOn(window, 'scrollTo');
  const { user, contexts } = await refusedOnce('stale_version', NEWER());
  await user.click(reviewButton());
  await screen.findByText('The newer text.');
  expect(contexts).toHaveLength(2);
  expect(scroll).toHaveBeenCalledWith({ top: 0 });
  expect(screen.getByRole('heading', { level: 1, name: 'Individual CLA' })).toHaveFocus();
  expect(screen.queryByText(messages['sign.stale.title'])).toBeNull();
  expect(screen.getByText('2.2')).toBeInTheDocument();
  expect(screen.getByText(`sha256:${NEWER_SHA.slice(0, 12)}`)).toBeInTheDocument();
});

test('after the review the name stays, the consent must be given again, and the request carries the new version and hash', async () => {
  const { user, calls } = await refusedOnce('stale_version', NEWER());
  await user.click(reviewButton());
  await screen.findByText('The newer text.');
  expect(nameInput()).toHaveValue('Ada Lovelace');
  expect(consentBox()).not.toBeChecked();
  expect(signButton()).toBeDisabled();
  await user.click(consentBox());
  await waitFor(() => {
    expect(signButton()).toBeEnabled();
  });
  await user.click(signButton());
  await screen.findByRole('heading', { level: 2, name: messages['sign.done.title'] });
  expect(calls.sign).toHaveLength(2);
  expect(bodyOf(calls.sign)).toMatchObject({ versionId: 31, contentSha256: SHA });
  expect(JSON.parse(calls.sign[1]?.text ?? '')).toMatchObject({ versionId: 32, contentSha256: NEWER_SHA });
  expect(calls.sign.filter((request) => request.text.includes(SHA))).toHaveLength(1);
});

test('"Review the new version" is busy while the context is asked for', async () => {
  const { user } = await refusedOnce('stale_version');
  const { release } = serveHeldContext();
  await user.click(reviewButton());
  await waitFor(() => {
    expect(reviewButton()).toHaveAttribute('aria-busy', 'true');
  });
  release(NEWER());
  await screen.findByText('The newer text.');
});

test('when only the consent sentence changed (stale_consent) the new sentence and its id are what the next request carries', async () => {
  const sentence = 'I agree to the revised consent sentence (test).';
  const revised = json(contextOf({ consent: { id: 'individual-v2', text: sentence } }));
  const { user, calls } = await refusedOnce('stale_consent', revised);
  await user.click(reviewButton());
  const box = await screen.findByRole('checkbox', { name: (name) => name.startsWith(sentence) });
  expect(box).not.toBeChecked();
  await user.click(box);
  await user.click(signButton());
  await screen.findByRole('heading', { level: 2, name: messages['sign.done.title'] });
  expect(JSON.parse(calls.sign[1]?.text ?? '')).toMatchObject({ consentTextId: 'individual-v2', versionId: 31 });
});

test('a review that finds the same text clears the banner and leaves the consent to be given again', async () => {
  const { user } = await refusedOnce('stale_version', contextResponse());
  await user.click(reviewButton());
  await waitFor(() => {
    expect(screen.queryByText(messages['sign.stale.title'])).toBeNull();
  });
  expect(consentBox()).not.toBeChecked();
  expect(nameInput()).toHaveValue('Ada Lovelace');
});

test('a review that fails keeps the banner and the disabled button, shows the failure, and still sends nothing', async () => {
  const { user, calls } = await refusedOnce('stale_version', failure(500, 'internal_server_error'));
  await user.click(reviewButton());
  expect(await screen.findByText(messages['errors.internal_server_error'])).toBeInTheDocument();
  expect(screen.getByText(messages['sign.stale.title'])).toBeInTheDocument();
  expect(signButton()).toBeDisabled();
  await user.click(consentBox());
  fireEvent.submit(nameInput());
  expect(calls.sign).toHaveLength(1);
});

test('a review that finds the CLA withdrawn replaces the page with the neutral state', async () => {
  const { user } = await refusedOnce('stale_version', failure(409, 'no_active_cla'));
  await user.click(reviewButton());
  expect(await screen.findByRole('heading', { level: 1, name: messages['sign.noCla.title'] })).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).toBeNull();
});

test('a 409 no_active_cla on submit replaces the page with the neutral state, no form, and focus on its heading', async () => {
  serveSign({ sign: failure(409, 'no_active_cla') });
  const { user } = await openFilled();
  await user.click(signButton());
  const heading = await screen.findByRole('heading', { level: 1, name: messages['sign.noCla.title'] });
  expect(heading).toHaveFocus();
  expect(within(pageMain()).queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('article')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
});

test('the stale banner passes axe, and so does the page after the review', async () => {
  const { user, container } = await refusedOnce('stale_version', NEWER());
  await expectNoA11yViolations(container);
  await user.click(reviewButton());
  await screen.findByText('The newer text.');
  await expectNoA11yViolations(container);
});

test('a keyboard user reaches "Review the new version" with Tab from the banner heading and presses it with Enter', async () => {
  const { user, banner } = await refusedOnce('stale_version', NEWER());
  expect(banner).toHaveFocus();
  await user.tab();
  expect(reviewButton()).toHaveFocus();
  await user.keyboard('{Enter}');
  await screen.findByText('The newer text.');
  expect(screen.getByRole('heading', { level: 1, name: 'Individual CLA' })).toHaveFocus();
});
