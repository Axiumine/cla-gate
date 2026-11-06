// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  bodyOf,
  consentBox,
  contextResponse,
  emailChoice,
  fillForm,
  nameInput,
  openSignPage,
  REFUSED_NAMES,
  serveSign,
  signButton,
  TWO_EMAILS,
} from './test-support.ts';

// E18-S01: the consent form: a required checkbox with the consent sentence of the server, a typed full name, and a choice among
// the verified addresses of GitHub. The button is off until the form is valid.

test('the form has the consent box, the name, and the address choice, and no field to type an address', async () => {
  serveSign();
  await openSignPage();
  expect(consentBox()).toBeRequired();
  expect(consentBox()).not.toBeChecked();
  expect(nameInput()).toBeRequired();
  expect(nameInput()).toHaveAttribute('autocomplete', 'name');
  expect(
    screen.getByRole('radiogroup', { name: (name) => name.startsWith(messages['sign.email.label']) }),
  ).toBeRequired();
  expect(screen.getAllByRole('textbox')).toEqual([nameInput()]);
  expect(screen.queryByRole('textbox', { name: /e-?mail/i })).toBeNull();
});

test('the label of the box is the consent sentence the server sent', async () => {
  serveSign();
  await openSignPage();
  expect(screen.getByText(/test sentence/)).toBeInTheDocument();
  expect(consentBox()).toHaveAccessibleName(/^I have read this agreement .* \(test sentence\)\./);
});

test('the one verified address is chosen already, and the choice shows that it is the primary one', async () => {
  serveSign();
  await openSignPage();
  expect(emailChoice('ada@example.org')).toBeChecked();
  expect(screen.getByText(`(${messages['sign.email.primary']})`)).toBeInTheDocument();
});

test('with several verified addresses none is chosen, each is an option, and the primary one is marked', async () => {
  serveSign({ context: contextResponse({ emails: TWO_EMAILS }) });
  await openSignPage();
  const group = screen.getByRole('radiogroup', { name: (name) => name.startsWith(messages['sign.email.label']) });
  expect(within(group).getAllByRole('radio')).toHaveLength(2);
  expect(emailChoice('ada@example.org')).not.toBeChecked();
  expect(emailChoice('lovelace@example.net')).not.toBeChecked();
  expect(screen.getAllByText(`(${messages['sign.email.primary']})`)).toHaveLength(1);
});

test('without the consent, a name or an address the button is off; with all three it is on', async () => {
  serveSign({ context: contextResponse({ emails: TWO_EMAILS }) });
  const { user } = await openSignPage();
  await waitFor(() => {
    expect(signButton()).toBeDisabled();
  });
  await user.click(consentBox());
  await user.click(nameInput());
  await user.paste('Ada Lovelace');
  expect(signButton()).toBeDisabled();
  await user.click(emailChoice('lovelace@example.net'));
  await waitFor(() => {
    expect(signButton()).toBeEnabled();
  });
  await user.click(consentBox());
  await waitFor(() => {
    expect(signButton()).toBeDisabled();
  });
});

test('with the box ticked and the one address chosen, the name alone decides whether the button is on', async () => {
  serveSign();
  const { user } = await openSignPage();
  await user.click(consentBox());
  expect(signButton()).toBeDisabled();
  await user.click(nameInput());
  await user.paste('   ');
  expect(signButton()).toBeDisabled();
  await user.clear(nameInput());
  await user.paste('Ada');
  await waitFor(() => {
    expect(signButton()).toBeEnabled();
  });
});

test.each(REFUSED_NAMES)('a name with %s is refused on its field, and the button stays off', async (_label, name) => {
  serveSign();
  const { user } = await openSignPage();
  await user.click(consentBox());
  await user.click(nameInput());
  fireEvent.change(nameInput(), { target: { value: name } });
  await user.tab();
  expect(await screen.findByRole('alert')).toHaveTextContent(messages['sign.name.invalid']);
  expect(nameInput()).toHaveAttribute('aria-invalid', 'true');
  expect(signButton()).toBeDisabled();
});

test('a name of 200 characters is accepted', async () => {
  serveSign();
  const { user } = await openSignPage();
  await user.click(consentBox());
  fireEvent.change(nameInput(), { target: { value: 'n'.repeat(200) } });
  await waitFor(() => {
    expect(signButton()).toBeEnabled();
  });
});

test('nothing is reported as wrong before the person has touched a field', async () => {
  serveSign();
  await openSignPage();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(nameInput()).not.toHaveAttribute('aria-invalid', 'true');
});

test('leaving the name empty reports it, and typing a name takes the report away', async () => {
  serveSign();
  const { user } = await openSignPage();
  await user.click(nameInput());
  await user.tab();
  expect(await screen.findByRole('alert')).toHaveTextContent(messages['sign.name.invalid']);
  await user.click(nameInput());
  await user.paste('Ada');
  await waitFor(() => {
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

test('leaving the box unticked after touching it reports that the consent is needed', async () => {
  serveSign();
  const { user } = await openSignPage();
  await user.click(consentBox());
  await user.click(consentBox());
  await user.tab();
  expect(await screen.findByRole('alert')).toHaveTextContent(messages['sign.consent.required']);
});

test('the form is operated with the keyboard alone: space ticks the box, the arrow keys choose an address, enter signs', async () => {
  const calls = serveSign({ context: contextResponse({ emails: TWO_EMAILS }) });
  const { user } = await openSignPage();
  consentBox().focus();
  await user.keyboard(' ');
  expect(consentBox()).toBeChecked();
  await user.tab();
  expect(nameInput()).toHaveFocus();
  await user.keyboard('Ada Lovelace');
  await user.tab();
  expect(emailChoice('ada@example.org')).toHaveFocus();
  await user.keyboard(' ');
  expect(emailChoice('ada@example.org')).toBeChecked();
  await waitFor(() => {
    expect(signButton()).toBeEnabled();
  });
  nameInput().focus();
  await user.keyboard('{Enter}');
  await waitFor(() => {
    expect(calls.sign).toHaveLength(1);
  });
  expect(bodyOf(calls.sign)).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.org' });
});

test('the form passes axe, filled and with an error shown', async () => {
  serveSign();
  const { user, container } = await openSignPage();
  await fillForm(user);
  await expectNoA11yViolations(container);
  await user.click(nameInput());
  fireEvent.change(nameInput(), { target: { value: 'Ada\u0007' } });
  await user.tab();
  await screen.findByRole('alert');
  await expectNoA11yViolations(container);
});
