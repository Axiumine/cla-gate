// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { envelope } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  bodyOf,
  button,
  detailOf,
  editorField,
  held,
  listedOf,
  openPublish,
  publishDialog,
  publishedAs,
  rationaleField,
  resignRequired,
  statusRegion,
  submitButton,
  versionOf,
} from './test-support.ts';

// E18-S05: what a publish ends in. A 201 shows the new active version and clears the draft state; every refusal keeps the draft on screen.

type Opened = Awaited<ReturnType<typeof openPublish>>;

/** Types a rationale and presses "Publish version". */
async function publish({ user }: Opened, rationale = 'Clarified the grant') {
  await user.click(rationaleField());
  await user.paste(rationale);
  await user.click(submitButton());
}

const facts = () => screen.getByText(messages['document.facts.version']).closest('dl');
const resignCheckbox = () =>
  within(publishDialog()).getByRole('checkbox', {
    name: `${messages['publish.resign.confirm']} ${messages['common.required']}`,
  });

test('201 closes the dialog, shows the new active version with "signatures stay valid", clears the draft state, and keeps the text', async () => {
  const opened = await openPublish({ publish: [publishedAs(1, 1)] });
  await publish(opened);
  expect(await statusRegion('Version 1.1 is now the active version')).toBeInTheDocument();
  expect(screen.getByText(messages['editor.published.same'])).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(facts()).toHaveTextContent('1.1');
  expect(screen.getByText(messages['document.facts.draft']).closest('dl')).toHaveTextContent(
    messages['document.facts.noDraft'],
  );
  expect(screen.queryByRole('button', { name: messages['editor.discard'] })).toBeNull();
  expect(editorField()).toHaveValue('abc');
  expect(screen.queryByText(messages['editor.published.resign'])).toBeNull();
});

test('201 of a major version that asks everyone to sign again shows the banner about it', async () => {
  const opened = await openPublish({ publish: [publishedAs(2, 0, 4, true)] });
  await opened.user.click(within(publishDialog()).getByRole('radio', { name: messages['publish.bump.major'] }));
  await publish(opened);
  expect(await statusRegion('Version 2.0 is now the active version')).toBeInTheDocument();
  expect(screen.getByText(messages['editor.published.resign'])).toBeInTheDocument();
  expect(screen.queryByText(messages['editor.published.same'])).toBeNull();
  expect(facts()).toHaveTextContent('2.0');
});

test('after a publish there is no draft to publish again: the dialog asks to save first, and nothing is unsaved', async () => {
  const opened = await openPublish({ publish: [publishedAs(1, 1)] });
  await publish(opened);
  await statusRegion('Version 1.1 is now the active version');
  await opened.user.click(button(messages['editor.publish']));
  expect(await screen.findByText(messages['publish.saveFirst'])).toBeInTheDocument();
});

test('the publish button is busy while the request is under way, and a double click sends one request', async () => {
  const gate = held(publishedAs(1, 1));
  const opened = await openPublish({ publish: [gate.answer] });
  await opened.user.click(rationaleField());
  await opened.user.paste('Clarified');
  await opened.user.dblClick(submitButton());
  await waitFor(() => {
    expect(submitButton()).toHaveAttribute('aria-busy', 'true');
  });
  expect(opened.served.publish).toHaveLength(1);
  gate.release();
  await statusRegion('Version 1.1 is now the active version');
  expect(opened.served.publish).toHaveLength(1);
});

test('422 content_unchanged shows its message in the dialog, keeps the dialog and the draft, and lets the person choose major', async () => {
  const opened = await openPublish({ publish: [envelope(422, 'content_unchanged'), publishedAs(2, 0, 0, true)] });
  await publish(opened);
  expect(await within(publishDialog()).findByText(messages['documents.rule.content_unchanged'])).toBeInTheDocument();
  expect(within(publishDialog()).getByRole('alert')).toHaveTextContent(messages['documents.rule.content_unchanged']);
  expect(rationaleField()).toHaveValue('Clarified the grant');
  await opened.user.click(within(publishDialog()).getByRole('radio', { name: messages['publish.bump.major'] }));
  await opened.user.click(submitButton());
  await statusRegion('Version 2.0 is now the active version');
  expect(bodyOf(opened.served.publish[1])).toMatchObject({ bump: 'major' });
  expect(editorField()).toHaveValue('abc');
});

test('after content_unchanged the draft is still on screen behind the dialog and is still a saved draft', async () => {
  const opened = await openPublish({ publish: [envelope(422, 'content_unchanged')] });
  await publish(opened);
  await within(publishDialog()).findByText(messages['documents.rule.content_unchanged']);
  await opened.user.click(within(publishDialog()).getByRole('button', { name: messages['common.cancel'] }));
  expect(editorField()).toHaveValue('abc');
  expect(screen.getByText(messages['document.facts.draft']).closest('dl')).toHaveTextContent(
    messages['documents.draftSaved'],
  );
  expect(screen.getByRole('button', { name: messages['editor.discard'] })).toBeInTheDocument();
});

test.each([
  ['version_conflict', 409, messages['documents.rule.version_conflict']],
  ['first_version_must_be_major', 422, messages['documents.rule.first_version_must_be_major']],
] as const)('%s is shown in the dialog in its own words', async (code, status, message) => {
  const opened = await openPublish({ publish: [envelope(status, code)] });
  await publish(opened);
  expect(await within(publishDialog()).findByText(message)).toBeInTheDocument();
});

test('a rationale the server refuses (invalid_rationale) is marked on the field, and editing it takes the mark away', async () => {
  const opened = await openPublish({ publish: [envelope(422, 'invalid_rationale')] });
  await publish(opened, 'Has a character the server refuses');
  await waitFor(() => {
    expect(rationaleField()).toBeInvalid();
  });
  expect(within(publishDialog()).getByText(messages['documents.rule.invalid_rationale'])).toBeInTheDocument();
  await opened.user.type(rationaleField(), '!');
  expect(rationaleField()).toBeValid();
});

test('409 stale_active_version closes the dialog, keeps the draft on screen, and offers "Load latest"', async () => {
  const opened = await openPublish({ publish: [envelope(409, 'stale_active_version', {}, { activeVersionId: 302 })] });
  await publish(opened);
  const banner = await screen.findByRole('alert');
  expect(banner).toHaveTextContent(messages['editor.stale.title']);
  expect(banner).toHaveTextContent(messages['editor.stale.message']);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(editorField()).toHaveValue('abc');
  expect(screen.getByText(messages['document.facts.draft']).closest('dl')).toHaveTextContent(
    messages['documents.draftSaved'],
  );
  expect(facts()).toHaveTextContent('1.0');
});

test('"Load latest" of a newer version makes it the active one, clears the warning and keeps the draft; publishing then expects that version', async () => {
  const newer = listedOf({
    activeVersion: versionOf({ id: 302, major: 2, minor: 0, publishedAt: '2026-10-04T08:00:00.000Z' }),
  });
  const opened = await openPublish({
    publish: [envelope(409, 'stale_active_version', {}, { activeVersionId: 302 }), publishedAs(2, 1)],
    detail: [detailOf(), detailOf(newer)],
  });
  await publish(opened);
  await screen.findByRole('alert');
  await opened.user.click(button(messages['editor.stale.load']));
  expect(await statusRegion(messages['editor.loadedActive'])).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(facts()).toHaveTextContent('2.0');
  expect(editorField()).toHaveValue('abc');
  await opened.user.click(button(messages['editor.publish']));
  await opened.user.click(rationaleField());
  await opened.user.paste('On top of 2.0');
  await opened.user.click(submitButton());
  await statusRegion('Version 2.1 is now the active version');
  expect(bodyOf(opened.served.publish[1])).toMatchObject({ expectedActiveVersionId: 302, bump: 'minor' });
});

test('409 draft_conflict during a publish closes the dialog and shows the conflict banner, with the text kept', async () => {
  const opened = await openPublish({ publish: [envelope(409, 'draft_conflict', {}, { currentRevision: 5 })] });
  await publish(opened);
  const banner = await screen.findByRole('alert');
  expect(banner).toHaveTextContent(messages['editor.conflict.title']);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(editorField()).toHaveValue('abc');
});

test('a 403 keeps the dialog and the text, and shows the forbidden message', async () => {
  const opened = await openPublish({ publish: [envelope(403, 'forbidden')] });
  await publish(opened);
  expect(await within(publishDialog()).findByRole('alert')).toHaveTextContent(messages['errors.forbidden']);
  expect(rationaleField()).toHaveValue('Clarified the grant');
  expect(submitButton()).toBeEnabled();
});

test('409 resign_confirmation_required shows how many contributors must sign again and asks for the checkbox before anything is sent again', async () => {
  const opened = await openPublish({ publish: [resignRequired(3), publishedAs(2, 0, 3, true)] });
  await opened.user.click(within(publishDialog()).getByRole('radio', { name: messages['publish.bump.major'] }));
  await publish(opened);
  const alert = await within(publishDialog()).findByRole('alert');
  expect(alert).toHaveTextContent(messages['publish.resign.title']);
  expect(alert).toHaveTextContent('3 contributors have signed the current major version and must sign again.');
  expect(resignCheckbox()).not.toBeChecked();
  expect(submitButton()).toBeDisabled();
  expect(opened.served.publish).toHaveLength(1);
  expect(bodyOf(opened.served.publish[0])).not.toHaveProperty('acknowledgeResigning');
  expect(within(publishDialog()).getByText(messages['publish.immutable'])).toBeInTheDocument();
});

test('with the checkbox ticked the same request is sent again with acknowledgeResigning: true, and the 201 closes the dialog with the banner', async () => {
  const opened = await openPublish({ publish: [resignRequired(3), publishedAs(2, 0, 3, true)] });
  await opened.user.click(within(publishDialog()).getByRole('radio', { name: messages['publish.bump.major'] }));
  await publish(opened);
  await within(publishDialog()).findByRole('alert');
  await opened.user.click(resignCheckbox());
  expect(submitButton()).toBeEnabled();
  await opened.user.click(submitButton());
  expect(await statusRegion('Version 2.0 is now the active version')).toBeInTheDocument();
  expect(screen.getByText(messages['editor.published.resign'])).toBeInTheDocument();
  expect(opened.served.publish).toHaveLength(2);
  expect(bodyOf(opened.served.publish[1])).toEqual({
    source: { type: 'draft', revision: 3 },
    bump: 'major',
    rationale: 'Clarified the grant',
    expectedActiveVersionId: 301,
    acknowledgeResigning: true,
  });
});

test('a rationale edited while the first request is out does not lock the form: the confirmed publish is sent once the re-signing question is answered', async () => {
  const gate = held(resignRequired(3));
  const opened = await openPublish({ publish: [gate.answer, publishedAs(2, 0, 3, true)] });
  await opened.user.click(within(publishDialog()).getByRole('radio', { name: messages['publish.bump.major'] }));
  await publish(opened);
  await waitFor(() => {
    expect(opened.served.publish).toHaveLength(1);
  });
  await opened.user.type(rationaleField(), '!');
  gate.release();
  await opened.user.click(await within(publishDialog()).findByRole('checkbox'));
  expect(submitButton()).toBeEnabled();
  await opened.user.click(submitButton());
  expect(await statusRegion('Version 2.0 is now the active version')).toBeInTheDocument();
  expect(opened.served.publish).toHaveLength(2);
  expect(bodyOf(opened.served.publish[1])).toMatchObject({
    rationale: 'Clarified the grant!',
    acknowledgeResigning: true,
  });
});

test('one contributor is said in the singular', async () => {
  const opened = await openPublish({ publish: [resignRequired(1)] });
  await opened.user.click(within(publishDialog()).getByRole('radio', { name: messages['publish.bump.major'] }));
  await publish(opened);
  expect(await within(publishDialog()).findByRole('alert')).toHaveTextContent(
    '1 contributor has signed the current major version and must sign again.',
  );
});

test('a resign answer without its number is the general error, and the form goes on working', async () => {
  const opened = await openPublish({ publish: [envelope(409, 'resign_confirmation_required')] });
  await publish(opened);
  expect(await within(publishDialog()).findByRole('alert')).toHaveTextContent(messages['errors.unknown']);
  expect(within(publishDialog()).queryByRole('checkbox')).toBeNull();
  expect(submitButton()).toBeEnabled();
});

test('the re-signing confirmation and a failed publish pass axe', async () => {
  const opened = await openPublish({ publish: [resignRequired(2), envelope(500, 'internal_server_error')] });
  await opened.user.click(within(publishDialog()).getByRole('radio', { name: messages['publish.bump.major'] }));
  await publish(opened);
  await within(publishDialog()).findByRole('alert');
  await expectNoA11yViolations(document.body);
  await opened.user.click(resignCheckbox());
  await opened.user.click(submitButton());
  await within(publishDialog()).findByText(messages['errors.internal_server_error']);
  await expectNoA11yViolations(document.body);
});
