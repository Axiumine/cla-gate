// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { envelope, json } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { CSRF_TOKEN } from '../test-support/session.ts';
import { csrfOf, fieldOf, off, on, openSettings, SNIPPET, toggle } from './test-support.ts';

// E22-S03: the public badge on the settings screen of a repository. The switch is the opt-in, the snippet is shown only while it
// is on, and every state of the server's answer has its screen.

test('with the opt-in on, the switch is on and the Markdown and the HTML are in read-only fields, exactly as the server built them', async () => {
  const { container } = openSettings([on()]);
  expect(await screen.findByRole('checkbox', { name: messages['repository.badge.toggle'] })).toBeChecked();
  expect(fieldOf(messages['repository.badge.markdown'])).toHaveValue(SNIPPET.markdown);
  expect(fieldOf(messages['repository.badge.html'])).toHaveValue(SNIPPET.html);
  expect(fieldOf(messages['repository.badge.markdown'])).toHaveAttribute('readonly');
  expect(fieldOf(messages['repository.badge.html'])).toHaveAttribute('readonly');
  expect(screen.queryByText(messages['repository.badge.offHint'])).toBeNull();
  await expectNoA11yViolations(container);
});

test('the screen is a level-one heading, then the public badge as a level-two heading, then the snippet under a level three', async () => {
  openSettings([on()]);
  expect(
    await screen.findByRole('heading', { level: 1, name: messages['repository.settings.title'] }),
  ).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: messages['repository.badge.title'] })).toBeInTheDocument();
  expect(
    await screen.findByRole('heading', { level: 3, name: messages['repository.badge.pasteTitle'] }),
  ).toBeInTheDocument();
  expect(screen.getByRole('region', { name: messages['repository.badge.title'] })).toBeInTheDocument();
});

test('with the opt-in off (409 public_verification_disabled) the switch is off, a hint says why there is no snippet, and no field is shown', async () => {
  const { container } = openSettings([off()]);
  expect(await screen.findByRole('checkbox', { name: messages['repository.badge.toggle'] })).not.toBeChecked();
  expect(screen.getByText(messages['repository.badge.offHint'])).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  await expectNoA11yViolations(container);
});

test('the explanation says what turning the badge on opens: a yes or no for one login, and no name, e-mail address or date', async () => {
  openSettings([off()]);
  expect(await screen.findByText(messages['repository.badge.intro'])).toBeInTheDocument();
  expect(messages['repository.badge.intro']).toContain('no name, e-mail address or date');
  expect(await screen.findByText(messages['repository.badge.enforcement'])).toBeInTheDocument();
});

test.each([
  ['a role that may not read it (403)', envelope(403, 'forbidden'), messages['errors.forbidden']],
  ['a repository that is not there (404)', envelope(404, 'not_found'), messages['errors.not_found']],
  ['a 409 that is not the disabled opt-in', envelope(409, 'conflict'), messages['errors.conflict']],
  ['an outage (500)', envelope(500, 'internal_server_error'), messages['errors.internal_server_error']],
])(
  '%s is an error and never a switch that looks off: the message is shown and no switch is',
  async (_what, answer, text) => {
    openSettings([answer]);
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  },
);

test('a 403 has the forbidden heading and no "Try again"; an outage can be tried again', async () => {
  openSettings([envelope(403, 'forbidden')]);
  expect(await screen.findByRole('heading', { name: messages['states.forbidden.title'] })).toBeInTheDocument();
  expect(within(screen.getByRole('alert')).queryByRole('button', { name: messages['states.retry'] })).toBeNull();
});

test('turning the switch on asks the server (PUT enabled true, with the CSRF token), then shows the snippet it reads back and says so politely', async () => {
  const { calls, user } = openSettings([off(), on()], [json({ enabled: true, changed: true })]);
  await user.click(await screen.findByRole('checkbox', { name: messages['repository.badge.toggle'] }));
  expect(await screen.findByRole('textbox', { name: messages['repository.badge.markdown'] })).toHaveValue(
    SNIPPET.markdown,
  );
  expect(calls.optIn.map((seen) => [seen.method, seen.text])).toEqual([['PUT', '{"enabled":true}']]);
  expect(csrfOf(calls.optIn[0])).toBe(CSRF_TOKEN);
  expect(toggle()).toBeChecked();
  expect(screen.getByText(messages['repository.badge.turnedOn']).closest('[role="status"]')).toHaveAttribute(
    'aria-live',
    'polite',
  );
  expect(calls.snippet).toHaveLength(2);
});

test('turning the switch off asks the server (PUT enabled false), then hides the snippet, and says so', async () => {
  const { calls, user } = openSettings([on(), off()], [json({ enabled: false, changed: true })]);
  await user.click(await screen.findByRole('checkbox', { name: messages['repository.badge.toggle'] }));
  expect(await screen.findByText(messages['repository.badge.offHint'])).toBeInTheDocument();
  expect(calls.optIn.map((seen) => seen.text)).toEqual(['{"enabled":false}']);
  expect(toggle()).not.toBeChecked();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.getByText(messages['repository.badge.turnedOff'])).toBeInTheDocument();
});

test('the switch is not assumed: when the server refuses the change (403) the switch stays as it was and an error is shown', async () => {
  const { calls, user } = openSettings([off()], [envelope(403, 'forbidden')]);
  await user.click(await screen.findByRole('checkbox', { name: messages['repository.badge.toggle'] }));
  expect(await screen.findByText(messages['errors.forbidden'])).toBeInTheDocument();
  expect(toggle()).not.toBeChecked();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByText(messages['repository.badge.turnedOn'])).toBeNull();
  expect(calls.snippet).toHaveLength(1);
});

test('the switch cannot be pressed twice while the change is on its way', async () => {
  const { calls, user } = openSettings([off(), on()], [json({ enabled: true, changed: true })]);
  const control = await screen.findByRole('checkbox', { name: messages['repository.badge.toggle'] });
  await user.dblClick(control);
  await waitFor(() => {
    expect(toggle()).toBeChecked();
  });
  expect(calls.optIn).toHaveLength(1);
});
