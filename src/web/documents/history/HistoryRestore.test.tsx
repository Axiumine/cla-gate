// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { messages } from '../../i18n/index.ts';
import { expectNoA11yViolations } from '../../test-support/a11y.ts';
import { bodyOf, publishedAs } from '../test-support.ts';
import { openRestore, publishOf, publishWith, rationaleOf, V1_0, V1_1, WITHIN_MAJOR } from './test-support.ts';

// E18-S11: "Restore this text" opens the publish dialog of E18-S05 with the source `{ type: 'version', versionId }`.

/** The SHA-256 of the text of version 1.1, `# Zzzz agreement`, a blank line, `One point one.` and a newline, computed outside the app. */
const ONE_POINT_ONE_HASH = 'd020510b975fbd584b73713badaa95e3de2716b8ca465d344e6876fd5574c9e1';

const minor = (dialog: HTMLElement) => within(dialog).getByRole('radio', { name: messages['publish.bump.minor'] });
const major = (dialog: HTMLElement) => within(dialog).getByRole('radio', { name: messages['publish.bump.major'] });

test('the dialog says that publishing creates a new version and that the old row is never reactivated, and that a version is immutable', async () => {
  const { dialog } = await openRestore('1.1');
  expect(dialog).toHaveAccessibleDescription(
    'Publishing creates a new version with this text. Version 1.1 is never reactivated: it stays in the history exactly as it is.',
  );
  expect(within(dialog).getByText(messages['publish.immutable'])).toBeInTheDocument();
});

test('it shows the number the new version would get, and the SHA-256 of the text that is published again, computed in the browser', async () => {
  const { dialog } = await openRestore('1.1');
  expect(within(dialog).getByText('Version 3.0')).toBeInTheDocument();
  expect(V1_1.contentMd).toBe('# Zzzz agreement\n\nOne point one.\n');
  expect(await within(dialog).findByText(`sha256:${ONE_POINT_ONE_HASH}`)).toBeInTheDocument();
});

test('a text of another major than the active one can only be published as a major one: minor is off, with the reason of the rule', async () => {
  const { dialog } = await openRestore('1.1');
  expect(minor(dialog)).toBeDisabled();
  expect(major(dialog)).toBeChecked();
  expect(within(dialog).getByText(messages['documents.rule.rollback_requires_major'])).toBeInTheDocument();
});

test('a text of the active major keeps minor as a choice, with nothing to explain', async () => {
  const { dialog } = await openRestore('1.0', { history: WITHIN_MAJOR });
  expect(minor(dialog)).toBeEnabled();
  expect(minor(dialog)).toBeChecked();
  expect(within(dialog).queryByText(messages['documents.rule.rollback_requires_major'])).toBeNull();
  expect(within(dialog).getByText('Version 1.2')).toBeInTheDocument();
});

test('the request names the version, the bump, the trimmed rationale and the active version the person saw, and carries no draft revision', async () => {
  const opened = await openRestore('1.1', { serve: { publish: [publishedAs(3, 0, 7, true)] } });
  await publishWith(opened, '  Went back to the wording of 1.1  ');
  await screen.findByText('Version 3.0 is now the active version');
  expect(opened.documents.publish).toHaveLength(1);
  expect(bodyOf(opened.documents.publish[0])).toEqual({
    source: { type: 'version', versionId: V1_1.id },
    bump: 'major',
    rationale: 'Went back to the wording of 1.1',
    expectedActiveVersionId: 303,
  });
  expect(new URL(opened.documents.publish[0]?.url ?? '').pathname).toBe('/api/installations/5/documents/11/versions');
});

test('a minor restore within the active major sends bump minor', async () => {
  const opened = await openRestore('1.0', { history: WITHIN_MAJOR, serve: { publish: [publishedAs(1, 2)] } });
  await publishWith(opened);
  await screen.findByText('Version 1.2 is now the active version');
  expect(bodyOf(opened.documents.publish[0])).toMatchObject({
    source: { type: 'version', versionId: V1_0.id },
    bump: 'minor',
    expectedActiveVersionId: V1_1.id,
  });
});

test('a rationale that is empty or blank is refused in the dialog, before any request', async () => {
  const opened = await openRestore('1.1');
  await opened.user.click(publishOf(opened.dialog));
  expect(await within(opened.dialog).findByText(messages['documents.rule.invalid_rationale'])).toBeInTheDocument();
  await opened.user.click(rationaleOf(opened.dialog));
  await opened.user.paste('   ');
  await opened.user.click(publishOf(opened.dialog));
  expect(opened.documents.publish).toEqual([]);
});

test('Cancel and Escape close the dialog without a request, and focus returns to the button that opened it', async () => {
  const opened = await openRestore('1.1');
  await opened.user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  const again = within(opened.region).getByRole('button', { name: messages['restore.action'] });
  expect(again).toHaveFocus();
  await opened.user.click(again);
  await opened.user.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: messages['common.cancel'] }),
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(opened.documents.publish).toEqual([]);
});

test('the restore dialog passes axe', async () => {
  await openRestore('1.1');
  await expectNoA11yViolations(document.body);
});
