// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { envelope } from '../../api/test-support.ts';
import { messages } from '../../i18n/index.ts';
import { summary, tenantOf } from '../../installations/test-support.ts';
import { expectNoA11yViolations } from '../../test-support/a11y.ts';
import { bodyOf, detailOf, held, listedOf, publishedAs, resignRequired, versionOf } from '../test-support.ts';
import {
  historyVersion,
  openHistory,
  openRestore,
  pageOf,
  publishOf,
  publishWith,
  resignOf,
  V1_0,
  V1_1,
  versionsTable,
  WITHIN_MAJOR,
} from './test-support.ts';

// E18-S11: what a restore ends in. A 201 makes the new version the active one everywhere; every refusal keeps the dialog, the rationale
// and the text on screen.

const editorTab = () => screen.getByRole('tab', { name: messages['document.tabs.editor'] });

test('201 closes the dialog and says which version is active now, with "signatures stay valid" for a minor one, and asks the list again', async () => {
  const newest = historyVersion({ id: 450, major: 1, minor: 2, active: true, contentMd: V1_0.contentMd });
  const opened = await openRestore('1.0', {
    history: {
      ...WITHIN_MAJOR,
      list: [pageOf(WITHIN_MAJOR.versions ?? []), pageOf([newest, { ...V1_1, active: false }, V1_0])],
    },
    serve: { publish: [publishedAs(1, 2)] },
  });
  await publishWith(opened);
  expect(
    await screen.findByText('Version 1.2 is now the active version', { selector: '[role="status"] *' }),
  ).toBeInTheDocument();
  expect(screen.getByText(messages['editor.published.same'])).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(opened.served.list.length).toBeGreaterThan(1);
  expect(within(versionsTable()).getByText('1.2')).toBeInTheDocument();
});

test('201 of a major version asks everyone to sign again, and the banner about the checks on open pull requests is shown', async () => {
  const opened = await openRestore('1.1', { serve: { publish: [publishedAs(3, 0, 7, true)] } });
  await publishWith(opened);
  expect(await screen.findByText(messages['editor.published.resign'])).toBeInTheDocument();
  expect(screen.queryByText(messages['editor.published.same'])).toBeNull();
});

test('after a restore the editor has the version as the active one and its text, and no draft', async () => {
  const opened = await openRestore('1.0', { history: WITHIN_MAJOR, serve: { publish: [publishedAs(1, 2)] } });
  await publishWith(opened);
  await screen.findByText(messages['editor.published.same']);
  await opened.user.click(editorTab());
  expect(screen.getByRole('textbox', { name: messages['editor.text.label'] })).toHaveValue(V1_0.contentMd);
  expect(screen.getByText(messages['document.facts.version']).closest('dl')).toHaveTextContent('1.2');
  expect(screen.getByText(messages['document.facts.draft']).closest('dl')).toHaveTextContent(
    messages['document.facts.noDraft'],
  );
});

test('a restore does not touch a saved draft: the text of the draft is still in the editor and still saved', async () => {
  const opened = await openRestore('1.0', {
    history: WITHIN_MAJOR,
    serve: {
      draft: [
        Response.json({ draft: { contentMd: 'Zzzz my draft', revision: 3, updatedAt: '2026-10-02T10:00:00.000Z' } }),
      ],
      publish: [publishedAs(1, 2)],
    },
  });
  await publishWith(opened);
  await screen.findByText(messages['editor.published.same']);
  await opened.user.click(editorTab());
  expect(screen.getByRole('textbox', { name: messages['editor.text.label'] })).toHaveValue('Zzzz my draft');
  expect(screen.getByRole('button', { name: messages['editor.discard'] })).toBeInTheDocument();
});

test('a 409 that asks to confirm the re-signing shows how many must sign again, and sends the same request with acknowledgeResigning', async () => {
  const opened = await openRestore('1.1', { serve: { publish: [resignRequired(7), publishedAs(3, 0, 7, true)] } });
  await publishWith(opened);
  expect(await within(opened.dialog).findByRole('alert')).toHaveTextContent(
    '7 contributors have signed the current major version and must sign again.',
  );
  expect(publishOf(opened.dialog)).toBeDisabled();
  await opened.user.click(resignOf(opened.dialog));
  await opened.user.click(publishOf(opened.dialog));
  await screen.findByText(messages['editor.published.resign']);
  expect(opened.documents.publish).toHaveLength(2);
  expect(bodyOf(opened.documents.publish[0])).not.toHaveProperty('acknowledgeResigning');
  expect(bodyOf(opened.documents.publish[1])).toMatchObject({
    acknowledgeResigning: true,
    source: { type: 'version', versionId: V1_1.id },
  });
});

test('a double click on "Publish version" sends one request, and the button is busy until the answer', async () => {
  const gate = held(publishedAs(3, 0, 7, true));
  const opened = await openRestore('1.1', { serve: { publish: [gate.answer] } });
  await opened.user.click(within(opened.dialog).getByRole('textbox', { name: /What changed/ }));
  await opened.user.paste('Went back');
  await opened.user.dblClick(publishOf(opened.dialog));
  expect(publishOf(opened.dialog)).toHaveAttribute('aria-busy', 'true');
  gate.release();
  await screen.findByText(messages['editor.published.resign']);
  expect(opened.documents.publish).toHaveLength(1);
});

const NEWER = historyVersion({
  id: 304,
  major: 2,
  minor: 1,
  active: true,
  contentMd: 'Zzzz newer text\n',
  rationale: 'Another admin',
});
const WAS_ACTIVE = { ...historyVersion(), active: false };
const detailAt = (id: number, minor: number) =>
  detailOf(listedOf({ activeVersion: versionOf({ id, major: 2, minor, contentSha256: 'c'.repeat(64) }) }));

test('another admin published first: the dialog closes, the history says so with "Load latest", and nothing changes until it is chosen', async () => {
  const opened = await openRestore('1.1', {
    serve: {
      publish: [envelope(409, 'stale_active_version'), publishedAs(3, 0, 7, true)],
      detail: [detailAt(303, 0), detailAt(304, 1)],
    },
    history: {
      versions: [NEWER, WAS_ACTIVE, V1_1, V1_0],
      list: [pageOf([WAS_ACTIVE, V1_1, V1_0]), pageOf([NEWER, WAS_ACTIVE, V1_1, V1_0])],
    },
  });
  await publishWith(opened);
  const banner = await screen.findByText(messages['editor.stale.title']);
  expect(banner.closest('[role="alert"]')).toHaveTextContent(messages['editor.stale.message']);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(within(versionsTable()).queryByText('2.1')).toBeNull();
  await opened.user.click(screen.getByRole('button', { name: messages['editor.stale.load'] }));
  expect(await within(versionsTable()).findByText('2.1')).toBeInTheDocument();
  expect(screen.queryByText(messages['editor.stale.title'])).toBeNull();
  expect(screen.getByText(messages['editor.loadedActive'])).toBeInTheDocument();
  await opened.user.click(within(opened.region).getByRole('button', { name: messages['restore.action'] }));
  await publishWith({ user: opened.user, dialog: await screen.findByRole('dialog') });
  await screen.findByText(messages['editor.published.resign']);
  expect(bodyOf(opened.documents.publish[1])).toMatchObject({ expectedActiveVersionId: 304 });
});

test('a failed "Load latest" is shown on the History tab, the warning stays, and the list and the version on screen are as they were', async () => {
  const opened = await openRestore('1.1', {
    serve: {
      publish: [envelope(409, 'stale_active_version')],
      detail: [detailAt(303, 0), envelope(502, 'github_unavailable')],
    },
  });
  await publishWith(opened);
  await screen.findByText(messages['editor.stale.title']);
  await opened.user.click(screen.getByRole('button', { name: messages['editor.stale.load'] }));
  const alerts = await screen.findAllByRole('alert');
  expect(alerts.some((alert) => alert.textContent.includes(messages['errors.github_unavailable']))).toBe(true);
  expect(screen.getByText(messages['editor.stale.title'])).toBeInTheDocument();
  expect(within(versionsTable()).getAllByRole('row')).toHaveLength(4);
  expect(screen.getByText('One point one.')).toBeInTheDocument();
});

test.each([
  [
    '422 rollback_requires_major',
    envelope(422, 'rollback_requires_major'),
    messages['documents.rule.rollback_requires_major'],
  ],
  ['422 content_unchanged', envelope(422, 'content_unchanged'), messages['documents.rule.content_unchanged']],
  ['422 invalid_rationale', envelope(422, 'invalid_rationale'), messages['documents.rule.invalid_rationale']],
  ['404 for a version that is not there', envelope(404, 'not_found'), messages['errors.not_found']],
  ['500', envelope(500, 'internal_server_error'), messages['errors.internal_server_error']],
])(
  '%s keeps the dialog open, with the reason in words and the rationale as it was typed',
  async (_what, refusal, words) => {
    const opened = await openRestore('1.0', { history: WITHIN_MAJOR, serve: { publish: [refusal] } });
    await publishWith(opened, 'Zzzz typed rationale');
    expect((await within(opened.dialog).findAllByText(words)).length).toBeGreaterThan(0);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(opened.dialog).getByRole('textbox', { name: /What changed/ })).toHaveValue('Zzzz typed rationale');
    expect(publishOf(opened.dialog)).toBeEnabled();
  },
);

test('a 403 is said in the dialog, and the text of the version stays on screen behind it', async () => {
  const opened = await openRestore('1.1', { serve: { publish: [envelope(403, 'forbidden')] } });
  await publishWith(opened);
  expect(await within(opened.dialog).findByText(messages['errors.forbidden'])).toBeInTheDocument();
  expect(opened.region).toHaveTextContent('One point one.');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

test('on a suspended installation nothing is restored: the button is off', async () => {
  const { user } = await openHistory({ serve: { tenants: [tenantOf(summary({ suspended: true }), 'acme/widgets')] } });
  await user.click(screen.getByRole('button', { name: messages['history.view.label'].replace('{version}', '1.1') }));
  const region = await screen.findByRole('region', { name: 'Version 1.1' });
  expect(within(region).getByRole('button', { name: messages['restore.action'] })).toBeDisabled();
});

test('the dialog with a refusal in it passes axe', async () => {
  const opened = await openRestore('1.1', { serve: { publish: [envelope(422, 'content_unchanged')] } });
  await publishWith(opened);
  await within(opened.dialog).findAllByText(messages['documents.rule.content_unchanged']);
  await expectNoA11yViolations(document.body);
});
