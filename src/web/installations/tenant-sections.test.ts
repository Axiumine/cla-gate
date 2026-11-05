// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { sectionLabel, switchTarget, TENANT_SECTIONS, TENANT_START, type TenantSection } from './tenant-sections.ts';

// E18-S04: where the tenant switcher takes a person: the same screen when the other installation has it, else the start.

const SECTIONS: readonly TenantSection<string>[] = [
  { to: '/installations/$installationId', roles: ['org_admin', 'repo_admin'] },
  { to: '/installations/$installationId/documents', roles: ['org_admin', 'repo_admin'] },
  { to: '/installations/$installationId/audit', roles: ['org_admin'] },
];
const START = '/installations/$installationId';

test("the same screen, when the other installation has it for the person's role", () => {
  expect(switchTarget(SECTIONS, START, '/installations/$installationId/documents', 'repo_admin')).toBe(
    '/installations/$installationId/documents',
  );
  expect(switchTarget(SECTIONS, START, '/installations/$installationId/audit', 'org_admin')).toBe(
    '/installations/$installationId/audit',
  );
});

test('the start of that installation when the role cannot open the screen', () => {
  expect(switchTarget(SECTIONS, START, '/installations/$installationId/audit', 'repo_admin')).toBe(START);
});

test.each([
  '/installations/$installationId/repositories/$repositoryId/settings',
  '/installations',
  '/me/signatures',
  '/',
])('the start of that installation from %s, a route that is not a screen of the table', (here) => {
  expect(switchTarget(SECTIONS, START, here, 'org_admin')).toBe(START);
});

test('the start of that installation when the route is not known at all', () => {
  expect(switchTarget(SECTIONS, START, undefined, 'org_admin')).toBe(START);
});

test('an index route, which the router spells with a trailing slash, is the screen of its parent path', () => {
  expect(switchTarget(SECTIONS, START, '/installations/$installationId/', 'repo_admin')).toBe(START);
  expect(switchTarget(SECTIONS, '/elsewhere', '/installations/$installationId/', 'repo_admin')).toBe(
    '/installations/$installationId',
  );
});

test('a bare slash is the root, not an empty path', () => {
  expect(switchTarget([{ to: '/', roles: ['org_admin'] }], START, '/', 'org_admin')).toBe('/');
});

test('the screens of the app are the overview, the allowlist, the signatures and the pending pull requests, for both roles, and the documents, for an org admin; a tenant starts on the overview', () => {
  expect(TENANT_SECTIONS).toEqual([
    { to: '/installations/$installationId', roles: ['org_admin', 'repo_admin'] },
    { to: '/installations/$installationId/documents', roles: ['org_admin'] },
    { to: '/installations/$installationId/allowlist', roles: ['org_admin', 'repo_admin'] },
    { to: '/installations/$installationId/signatures', roles: ['org_admin', 'repo_admin'] },
    { to: '/installations/$installationId/pending', roles: ['org_admin', 'repo_admin'] },
  ]);
  expect(TENANT_START).toBe('/installations/$installationId');
});

test('a repo admin keeps the overview and is taken there from the documents list, which only an org admin can open', () => {
  expect(switchTarget(TENANT_SECTIONS, TENANT_START, '/installations/$installationId/documents', 'repo_admin')).toBe(
    TENANT_START,
  );
  expect(switchTarget(TENANT_SECTIONS, TENANT_START, '/installations/$installationId/documents', 'org_admin')).toBe(
    '/installations/$installationId/documents',
  );
});

test('a repo admin keeps the allowlist when the other installation has it for them', () => {
  expect(switchTarget(TENANT_SECTIONS, TENANT_START, '/installations/$installationId/allowlist', 'repo_admin')).toBe(
    '/installations/$installationId/allowlist',
  );
});

test('a repo admin keeps the signatures when the other installation has them for them', () => {
  expect(switchTarget(TENANT_SECTIONS, TENANT_START, '/installations/$installationId/signatures', 'repo_admin')).toBe(
    '/installations/$installationId/signatures',
  );
});

test('a repo admin keeps the pending pull requests when the other installation has them for them', () => {
  expect(switchTarget(TENANT_SECTIONS, TENANT_START, '/installations/$installationId/pending', 'repo_admin')).toBe(
    '/installations/$installationId/pending',
  );
});

test('every screen has its words in the navigation', () => {
  expect(TENANT_SECTIONS.map((section) => sectionLabel(section.to))).toEqual([
    'tenant.nav.overview',
    'tenant.nav.documents',
    'tenant.nav.allowlist',
    'tenant.nav.signatures',
    'tenant.nav.pending',
  ]);
});
