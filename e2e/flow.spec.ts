// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { withDatabase } from './support/database.ts';
import { attachAndEnable, createAndPublish } from './support/steps/publish-steps.ts';
import { contributorSigns, maintainerRevokes } from './support/steps/signature-steps.ts';
import {
  addToAllowlist,
  expectAuditOfTheFlow,
  expectForeignTenantHidden,
  removeFromAllowlist,
} from './support/steps/tenant-steps.ts';
import { test } from './support/test.ts';
import { type FlowWorld, seedFlowWorld } from './support/world/flow-world.ts';

// E18-S12: the happy paths of the screens, in the order a real project goes through them, against the built server and a real
// database. The people, the tenant and the session cookies are written straight into the database (no OAuth round trip, no call to
// GitHub: the application under test has no GitHub App), and everything after that is done by clicking, as a person would. Locators are
// roles, labels and the sentences of the catalog (the steps are in e2e/support/steps). Every page is watched: a console error, an
// uncaught error, a dialog or a broken Content-Security-Policy fails the spec (e2e/support/test.ts).

test.describe.configure({ mode: 'serial' });

let world: FlowWorld;

test.beforeAll(async () => {
  world = await withDatabase((db) => seedFlowWorld(db, new Date()));
});

test('a maintainer creates a CLA document, saves a draft and publishes the first version', async ({ openPage }) => {
  await createAndPublish(await openPage({ cookie: world.maintainer.cookie }), world);
});

test('the maintainer attaches the document to the repository and enables the CLA check', async ({ openPage }) => {
  await attachAndEnable(await openPage({ cookie: world.maintainer.cookie }), world);
});

test('a contributor reads the CLA, agrees, types their name, picks a verified address and signs', async ({
  openPage,
}) => {
  await contributorSigns(await openPage({ cookie: world.contributor.cookie }), world);
});

test('the maintainer finds the signature of the contributor and revokes it', async ({ openPage }) => {
  await maintainerRevokes(await openPage({ cookie: world.maintainer.cookie }), world);
});

test('adding an allowlist entry needs GitHub to resolve the login: with no GitHub App the dialog says so and stores nothing', async ({
  openPage,
}) => {
  const refusal = { status: 502, path: `/api/installations/${String(world.tenant.id)}/allowlist-entries` };
  await addToAllowlist(await openPage({ cookie: world.maintainer.cookie, refusals: [refusal] }), world, 'octocat');
});

test('the maintainer removes an allowlist entry', async ({ openPage }) => {
  await removeFromAllowlist(await openPage({ cookie: world.maintainer.cookie }), world);
});

test('the audit log of the tenant shows each of those actions, and only those of this tenant', async ({ openPage }) => {
  await expectAuditOfTheFlow(await openPage({ cookie: world.maintainer.cookie }), world);
});

test('a tenant of someone else is not reachable by its address: its pages say not found, and it is not in the lists', async ({
  openPage,
}) => {
  const refusal = { status: 404, path: `/api/installations/${String(world.foreign.id)}`, within: true } as const;
  await expectForeignTenantHidden(await openPage({ cookie: world.maintainer.cookie, refusals: [refusal] }), world);
});
