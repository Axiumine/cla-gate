// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { messages as m } from '../../../src/web/i18n/messages.ts';
import { expect, type Page } from '../test.ts';
import type { FlowWorld } from '../world/flow-world.ts';
import { tenantPath } from './flow-paths.ts';

// E18-S12: the allowlist, the audit log and the borders of a tenant.

/** Adds a login to the allowlist, which the application can only do by asking GitHub who that is: with no GitHub App the dialog says so. */
export async function addToAllowlist(page: Page, world: FlowWorld, login: string): Promise<void> {
  await page.goto(tenantPath(world, 'allowlist'));
  await page.getByRole('button', { name: m['allowlist.add'] }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(m['allowlist.add.login']).fill(login);
  await dialog.getByRole('button', { name: m['allowlist.add.submit'] }).click();
  await expect(dialog.getByRole('alert')).toContainText(m['errors.github_unavailable']);
  await expect(page.getByRole('row').filter({ hasText: login })).toHaveCount(0);
}

/** Removes the entry the world starts with, after the confirmation; its row is gone. */
export async function removeFromAllowlist(page: Page, world: FlowWorld): Promise<void> {
  await page.goto(tenantPath(world, 'allowlist'));
  await page.getByRole('button', { name: m['allowlist.remove.label'].replace('{account}', world.allowlisted) }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: m['allowlist.remove.confirm'] }).click();
  await expect(page.getByText(m['allowlist.notice.removed'])).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: world.allowlisted })).toHaveCount(0);
}

/** The actions the steps of the maintainer make, as the audit log words them. */
const EXPECTED_EVENTS = [
  m['audit.action.cla_document.created'],
  m['audit.action.cla_draft.saved'],
  m['audit.action.cla_version.published'],
  m['audit.action.repository.cla_document_attached'],
  m['audit.action.repository.enabled'],
  m['audit.action.signature.created'],
  m['audit.action.signature.revoked'],
  m['audit.action.allowlist_entry.deleted'],
] as const;

/** The audit log shows one line for each of those actions and nothing else: the actions of other tenants are not in it. */
export async function expectAuditOfTheFlow(page: Page, world: FlowWorld): Promise<void> {
  await page.goto(tenantPath(world, 'audit'));
  const table = page.getByRole('table', { name: m['audit.caption'] });
  await expect(table).toBeVisible();
  for (const label of EXPECTED_EVENTS) {
    await expect(table.getByRole('row').filter({ hasText: label })).toHaveCount(1);
  }
  await expect(table.getByRole('row')).toHaveCount(EXPECTED_EVENTS.length + 1);
}

/** The pages of the other tenant say not found, and the other tenant is not in the list of installations. */
export async function expectForeignTenantHidden(page: Page, world: FlowWorld): Promise<void> {
  const foreign = `/installations/${String(world.foreign.id)}`;
  for (const rest of ['documents', 'signatures', 'audit']) {
    await page.goto(`${foreign}/${rest}`);
    await expect(page.getByText(m['errors.not_found'])).toBeVisible();
  }
  await page.goto('/installations');
  await expect(page.getByRole('heading', { level: 1, name: world.tenant.login })).toBeVisible();
  await expect(page.getByText(world.foreign.login)).toHaveCount(0);
}
