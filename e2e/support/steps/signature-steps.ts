// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { messages as m } from '../../../src/web/i18n/messages.ts';
import { expect, type Page } from '../test.ts';
import type { FlowWorld } from '../world/flow-world.ts';
import { DOCUMENT_NAME, DOCUMENT_SENTENCE, tenantPath } from './flow-paths.ts';

// E18-S12: the two ends of a signature: the contributor signs on the page the check run links to, and the maintainer finds it and revokes it.

/** The contributor reads the CLA on the signing page, agrees, types their name, picks a verified address and signs. */
export async function contributorSigns(page: Page, world: FlowWorld): Promise<void> {
  const { contributor, repository } = world;
  await page.goto(`/sign/${String(repository.githubId)}?pr=7`);
  await expect(page.getByRole('heading', { level: 1, name: DOCUMENT_NAME })).toBeVisible();
  await expect(page.getByRole('article')).toContainText(DOCUMENT_SENTENCE);
  await page.getByRole('checkbox').check();
  await page.getByRole('textbox', { name: m['sign.name.label'] }).fill(contributor.name);
  await page.getByRole('radio', { name: contributor.emails[0]?.email ?? '' }).check();
  await page.getByRole('button', { name: m['sign.submit'] }).click();
  await expect(page.getByRole('heading', { name: m['sign.done.title'] })).toBeFocused();
  await expect(page.getByText(contributor.name)).toBeVisible();
}

/** The maintainer finds the signature of the contributor in the list and revokes it with a reason; the row then says it is revoked. */
export async function maintainerRevokes(page: Page, world: FlowWorld): Promise<void> {
  await page.goto(tenantPath(world, 'signatures'));
  const row = page.getByRole('row').filter({ hasText: world.contributor.login });
  await row.getByRole('button', { name: m['signatures.revoke'] }).click();
  const dialog = page.getByRole('alertdialog');
  await dialog
    .getByLabel(m['signatures.revoke.reason'])
    .selectOption({ label: m['signatures.revoke.reason.maintainer_decision'] });
  await dialog.getByRole('button', { name: m['signatures.revoke.confirm'] }).click();
  await expect(page.getByText(m['signatures.notice.revoked'])).toBeVisible();
  await expect(row.getByText(m['status.revoked'])).toBeVisible();
}
