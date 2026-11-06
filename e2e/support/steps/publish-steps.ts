// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { messages as m } from '../../../src/web/i18n/messages.ts';
import { expect, type Page } from '../test.ts';
import type { FlowWorld } from '../world/flow-world.ts';
import { DOCUMENT_NAME, DOCUMENT_TEXT, forRepository, tenantPath } from './flow-paths.ts';

// E18-S12: what a maintainer does to get a CLA into force: write it, publish it, attach it to a repository and turn the check on.

/** Opens the editor of the document from the list, the way a person does. */
async function showDocument(page: Page, world: FlowWorld): Promise<void> {
  await page.goto(tenantPath(world, 'documents'));
  await page.getByRole('link', { name: DOCUMENT_NAME }).click();
  await page.getByRole('textbox', { name: m['editor.text.label'] }).waitFor();
}

/** Creates the document, saves its text as a draft and publishes the first version; the list then shows version 1.0. */
export async function createAndPublish(page: Page, world: FlowWorld): Promise<void> {
  await page.goto(tenantPath(world, 'documents'));
  await page.getByRole('button', { name: m['documents.new'] }).click();
  await page.getByRole('dialog').getByLabel(m['documents.new.name']).fill(DOCUMENT_NAME);
  await page.getByRole('dialog').getByRole('button', { name: m['documents.new.submit'] }).click();
  await page.getByRole('textbox', { name: m['editor.text.label'] }).fill(DOCUMENT_TEXT);
  await page.getByRole('button', { name: m['editor.save'] }).click();
  await expect(page.getByText(m['editor.saved'])).toBeVisible();
  await page.getByRole('button', { name: m['editor.publish'], exact: true }).click();
  await page.getByRole('dialog').getByLabel(m['publish.rationale']).fill('First version.');
  await page.getByRole('dialog').getByRole('button', { name: m['publish.submit'] }).click();
  await expect(page.getByText(m['editor.published.title'].replace('{version}', '1.0'))).toBeVisible();
  await showDocument(page, world);
  await expect(page.getByText('1.0', { exact: false }).first()).toBeVisible();
}

/** Attaches the published document to the repository of the world and turns the CLA check on for it. */
export async function attachAndEnable(page: Page, world: FlowWorld): Promise<void> {
  await page.goto(tenantPath(world, 'repositories'));
  await page.getByRole('button', { name: forRepository(world, m['repositories.attach.label']) }).click();
  await page
    .getByRole('dialog')
    .getByLabel(m['repositories.attach.field'])
    .selectOption({ label: `${DOCUMENT_NAME} (1.0), whole installation` });
  await page.getByRole('dialog').getByRole('button', { name: m['repositories.attach.submit'] }).click();
  await expect(page.getByText(forRepository(world, m['repositories.notice.attached']))).toBeVisible();
  await page.getByRole('button', { name: forRepository(world, m['repositories.enable.label']) }).click();
  await expect(page.getByText(forRepository(world, m['repositories.notice.enabled']))).toBeVisible();
}
