// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { HOSTILE_NAMES } from '../../shared/hostile-names.ts';
import { APP_NAME_PATTERN, GITHUB_LOGIN_PATTERN } from '../../shared/setup.ts';
import { messages } from '../i18n/index.ts';
import { AppRouter } from '../router.tsx';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { activeContent } from '../test-support/hostile.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { failure, SETUP_CSRF, serveSetup, stubRequestSubmit, unlockThroughThePage } from './test-support.ts';

// E19-S07: the form that follows the unlock. It collects the owner, the App name and the visibility, checks them with the
// rules of the server, and calls the manifest endpoint with the CSRF token of the setup session.

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * Presses an arrow key the way a person does: down, then up once the focus has moved (Radix moves focus a tick after the
 * keydown and checks the radio it lands on only while the key is still held, as the tests of the primitive explain).
 */
async function arrowTo(user: UserEvent, key: string, name: string): Promise<void> {
  await user.keyboard(`{${key}>}`);
  await waitFor(() => {
    expect(screen.getByRole('radio', { name })).toHaveFocus();
  });
  await user.keyboard(`{/${key}}`);
}

/** The form step, reached through the unlock. */
async function formStep(answers: Parameters<typeof serveSetup>[0] = {}) {
  stubRequestSubmit();
  const calls = serveSetup(answers);
  const rendered = renderWithProviders(<AppRouter />, { route: '/setup' });
  await unlockThroughThePage(rendered.user);
  return { calls, ...rendered };
}

const submit = () => screen.getByRole('button', { name: messages['setup.app.submit'] });
const nameField = () => screen.getByLabelText((label) => label.startsWith(messages['setup.app.name']));
const organisationLabelled = (label: string) => label.startsWith(messages['setup.app.organisation']);
const organisationField = () => screen.queryByLabelText(organisationLabelled);
const organisationInput = () => screen.getByLabelText(organisationLabelled);
const publicBox = () => screen.getByRole('checkbox', { name: messages['setup.app.public'] });

test('it offers a personal account or an organisation, a name, and the public checkbox; the button is the one of the story', async () => {
  await formStep();
  expect(screen.getByRole('radio', { name: messages['setup.app.ownerUser'] })).toBeChecked();
  expect(screen.getByRole('radio', { name: messages['setup.app.ownerOrganisation'] })).not.toBeChecked();
  expect(nameField()).toBeInTheDocument();
  expect(publicBox()).not.toBeChecked();
  expect(submit()).toHaveTextContent('Create the GitHub App on GitHub');
});

test('the organisation login field appears for an organisation and only then', async () => {
  const { user } = await formStep();
  expect(organisationField()).toBeNull();
  await user.click(screen.getByRole('radio', { name: messages['setup.app.ownerOrganisation'] }));
  expect(organisationField()).toBeRequired();
  expect(screen.getByText(messages['setup.app.organisationHelp'])).toBeInTheDocument();
  await user.click(screen.getByRole('radio', { name: messages['setup.app.ownerUser'] }));
  expect(organisationField()).toBeNull();
});

test('the name starts as "CLA Gate <host>", cut to the characters and the length the server accepts', async () => {
  await formStep();
  expect(nameField()).toHaveValue('CLA Gate localhost');
  expect(APP_NAME_PATTERN.test('CLA Gate localhost')).toBe(true);
});

test('the name offered for a host with dots, a port and a long label is sanitised and 34 characters at most', async () => {
  vi.stubGlobal('location', Object.assign({}, window.location, { host: `${'h'.repeat(40)}.example.org:8443` }));
  await formStep();
  const offered = `CLA Gate ${'h'.repeat(25)}`;
  expect(nameField()).toHaveValue(offered);
  expect(offered).toHaveLength(34);
  expect(APP_NAME_PATTERN.test(offered)).toBe(true);
});

test('the checkbox text explains the three facts: one account, a public App for several organisations, the admission policy', async () => {
  await formStep();
  const help = messages['setup.app.publicHelp'];
  expect(help).toMatch(/owned by one account can only be installed by that account/u);
  expect(help).toMatch(/several organisations needs a public App/u);
  expect(help).toMatch(/admission policy of this instance still decides which organisations may use this server/u);
  expect(publicBox()).toHaveAccessibleDescription(help);
});

test('a page opened over http carries the warning that the webhook is inactive and a tunnel is needed', async () => {
  await formStep();
  const warning = screen.getByText(messages['setup.app.httpWarning']);
  expect(warning).toBeInTheDocument();
  expect(messages['setup.app.httpWarning']).toMatch(/webhook of the App will be inactive/u);
  expect(messages['setup.app.httpWarning']).toMatch(/tunnel/u);
});

test('a page opened over https carries no such warning', async () => {
  vi.stubGlobal('location', Object.assign({}, window.location, { protocol: 'https:', host: 'cla.example.org' }));
  await formStep();
  expect(screen.queryByText(messages['setup.app.httpWarning'])).toBeNull();
  expect(nameField()).toHaveValue('CLA Gate cla-example-org');
});

test('a personal App is requested with the name, the visibility and the CSRF token of the setup session, and no organisation', async () => {
  const { calls, user } = await formStep();
  await user.click(submit());
  await waitFor(() => {
    expect(calls.manifest).toHaveLength(1);
  });
  const [sent] = calls.manifest;
  expect(sent?.method).toBe('POST');
  expect(JSON.parse(sent?.text ?? '')).toEqual({
    ownerType: 'user',
    appName: 'CLA Gate localhost',
    allowOtherAccounts: false,
  });
  expect(sent?.headers['x-csrf-token']).toBe(SETUP_CSRF);
  expect(sent?.headers['content-type']).toBe('application/json');
  expect(sent?.headers['authorization']).toBeUndefined();
});

test('an organisation App with other accounts allowed is requested with its login, trimmed of nothing and sent as typed', async () => {
  const { calls, user } = await formStep();
  await user.click(screen.getByRole('radio', { name: messages['setup.app.ownerOrganisation'] }));
  await user.type(organisationInput(), 'Acme-Inc');
  await user.clear(nameField());
  await user.type(nameField(), 'Our CLA Gate-2');
  await user.click(publicBox());
  expect(publicBox()).toBeChecked();
  await user.click(submit());
  await waitFor(() => {
    expect(calls.manifest).toHaveLength(1);
  });
  expect(JSON.parse(calls.manifest[0]?.text ?? '')).toEqual({
    ownerType: 'organisation',
    organisation: 'Acme-Inc',
    appName: 'Our CLA Gate-2',
    allowOtherAccounts: true,
  });
});

test('a login typed for an organisation and then abandoned for a personal App is not sent', async () => {
  const { calls, user } = await formStep();
  await user.click(screen.getByRole('radio', { name: messages['setup.app.ownerOrganisation'] }));
  await user.type(organisationInput(), 'acme');
  await user.click(screen.getByRole('radio', { name: messages['setup.app.ownerUser'] }));
  await user.click(submit());
  await waitFor(() => {
    expect(calls.manifest).toHaveLength(1);
  });
  const sent: unknown = JSON.parse(calls.manifest[0]?.text ?? '');
  expect(sent).not.toHaveProperty('organisation');
});

test('an organisation App with no login is refused before anything is sent, and the login field takes focus', async () => {
  const { calls, user } = await formStep();
  await user.click(screen.getByRole('radio', { name: messages['setup.app.ownerOrganisation'] }));
  await user.click(submit());
  const field = organisationInput();
  expect(field).toBeInvalid();
  expect(field).toHaveAccessibleDescription(
    expect.stringContaining(messages['setup.app.organisationInvalid'].slice(0, 20)),
  );
  expect(screen.getByRole('alert')).toHaveTextContent(messages['setup.app.organisationInvalid']);
  await waitFor(() => {
    expect(field).toHaveFocus();
  });
  expect(calls.manifest).toHaveLength(0);
});

test('an invalid name is refused before anything is sent, with its message, and the name field takes focus', async () => {
  const { calls, user } = await formStep();
  await user.clear(nameField());
  await user.type(nameField(), 'Not.Allowed');
  await user.click(submit());
  expect(nameField()).toBeInvalid();
  expect(screen.getByRole('alert')).toHaveTextContent(messages['setup.app.nameInvalid']);
  await waitFor(() => {
    expect(nameField()).toHaveFocus();
  });
  expect(calls.manifest).toHaveLength(0);
});

test.each([
  ['an empty name', ''],
  ['35 characters', 'a'.repeat(35)],
  ['an underscore', 'a_b'],
  ['a dot', 'a.b'],
  ['an accented letter', 'café'],
])('%s is refused as an App name, with the rule of the server', async (_what, name) => {
  const { calls, user } = await formStep();
  await user.clear(nameField());
  if (name !== '') {
    await user.paste(name);
  }
  await user.click(submit());
  expect(screen.getByRole('alert')).toHaveTextContent(messages['setup.app.nameInvalid']);
  expect(calls.manifest).toHaveLength(0);
});

test.each([
  ['a hyphen first', '-a'],
  ['a hyphen last', 'a-'],
  ['40 characters', 'a'.repeat(40)],
  ['a space', 'a b'],
  ['a slash', 'a/b'],
  ['dot dot', '..'],
])('%s is refused as an organisation login, with the rule of the server', async (_what, login) => {
  const { calls, user } = await formStep();
  await user.click(screen.getByRole('radio', { name: messages['setup.app.ownerOrganisation'] }));
  await user.click(organisationInput());
  await user.paste(login);
  await user.click(submit());
  expect(screen.getByRole('alert')).toHaveTextContent(messages['setup.app.organisationInvalid']);
  expect(calls.manifest).toHaveLength(0);
});

test('the corrected value clears the error and the request goes out', async () => {
  const { calls, user } = await formStep();
  await user.clear(nameField());
  await user.click(submit());
  expect(screen.getByRole('alert')).toBeInTheDocument();
  await user.type(nameField(), 'Fixed');
  await user.click(submit());
  await waitFor(() => {
    expect(calls.manifest).toHaveLength(1);
  });
  expect(screen.queryByText(messages['setup.app.nameInvalid'])).toBeNull();
});

test('every hostile name that the shared rules refuse is refused in both fields, sends nothing and leaves the page inert', async () => {
  const { calls, container, user } = await formStep();
  await user.click(screen.getByRole('radio', { name: messages['setup.app.ownerOrganisation'] }));
  for (const name of HOSTILE_NAMES.filter((hostile) => !APP_NAME_PATTERN.test(hostile))) {
    await user.clear(nameField());
    await user.click(nameField());
    await user.paste(name);
    await user.click(submit());
    expect(nameField(), JSON.stringify(name)).toBeInvalid();
    expect(activeContent(container)).toEqual([]);
  }
  await user.clear(nameField());
  await user.type(nameField(), 'Fine');
  for (const login of HOSTILE_NAMES.filter((hostile) => !GITHUB_LOGIN_PATTERN.test(hostile))) {
    await user.clear(organisationInput());
    await user.click(organisationInput());
    await user.paste(login);
    await user.click(submit());
    expect(organisationField(), JSON.stringify(login)).toBeInvalid();
    expect(activeContent(container)).toEqual([]);
  }
  expect(calls.manifest).toHaveLength(0);
});

test('a setup session that ended answers 401: the message says to start again, with a link that loads /setup afresh', async () => {
  const { user } = await formStep({ manifest: failure(401, 'setup_locked') });
  await user.click(submit());
  const alert = await screen.findByRole('alert', { name: '' });
  expect(alert).toHaveTextContent(messages['errors.setup_locked']);
  const link = screen.getByRole('link', { name: messages['setup.startAgain'] });
  expect(link).toHaveAttribute('href', '/setup');
  expect(screen.getByRole('heading', { level: 1, name: messages['setup.app.title'] })).toBeInTheDocument();
  expect(alert).not.toHaveTextContent(messages['errors.unauthenticated']);
});

test.each([
  [403, 'csrf_invalid', messages['errors.csrf_invalid']],
  [403, 'origin_mismatch', messages['errors.origin_mismatch']],
  [400, 'bad_request', messages['errors.bad_request']],
  [413, 'payload_too_large', messages['errors.payload_too_large']],
  [500, 'internal_server_error', messages['errors.internal_server_error']],
] as const)('a %i %s answer to the manifest shows %s and keeps the form', async (status, code, message) => {
  const { user } = await formStep({ manifest: failure(status, code) });
  await user.click(submit());
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(nameField()).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: messages['setup.startAgain'] })).toBeNull();
});

test('the form is operable by keyboard: arrow keys pick the owner, Space ticks the box, Enter sends the request', async () => {
  const { calls, user } = await formStep();
  screen.getByRole('radio', { name: messages['setup.app.ownerUser'] }).focus();
  await arrowTo(user, 'ArrowDown', messages['setup.app.ownerOrganisation']);
  expect(screen.getByRole('radio', { name: messages['setup.app.ownerOrganisation'] })).toBeChecked();
  await arrowTo(user, 'ArrowUp', messages['setup.app.ownerUser']);
  expect(screen.getByRole('radio', { name: messages['setup.app.ownerUser'] })).toBeChecked();
  publicBox().focus();
  await user.keyboard(' ');
  expect(publicBox()).toBeChecked();
  nameField().focus();
  await user.keyboard('{Enter}');
  await waitFor(() => {
    expect(calls.manifest).toHaveLength(1);
  });
  expect(JSON.parse(calls.manifest[0]?.text ?? '')).toMatchObject({ allowOtherAccounts: true });
});

test.each([
  ['a personal App', false],
  ['an organisation App with a wrong login', true],
])('the form of %s passes axe, with and without its errors', async (_what, organisation) => {
  const { container, user } = await formStep();
  await expectNoA11yViolations(container);
  if (organisation) {
    await user.click(screen.getByRole('radio', { name: messages['setup.app.ownerOrganisation'] }));
  }
  await user.clear(nameField());
  await user.click(submit());
  await screen.findAllByRole('alert');
  await expectNoA11yViolations(container);
});
