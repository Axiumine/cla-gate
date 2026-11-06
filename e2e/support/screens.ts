// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Refusal } from '../../scripts/e2e/console-rules.ts';
import { messages } from '../../src/web/i18n/messages.ts';
import { FOREIGN_TENANT, REPOSITORIES, SIGN_PR, TENANT } from './world/ids.ts';

// E18-S12: the screens of the application as the browser specs see them: where each one is, who looks at it, and what to wait
// for before it is photographed or checked. Plain data (no Playwright), so that a test of the web project can hold it against the
// routes of the router: a route with no screen here, and no reason for having none, fails it (src/web/route-screens.test.ts).
// Every sentence is the catalog's, so a changed sentence changes the wait with it.

/** Who opens the screen: a person of the seeded world (e2e/support/world/people.ts), or a visitor who is not logged in. */
export type Viewer = 'alice' | 'carol' | 'dan' | 'frank' | 'visitor';

/** What a screen shows when it has loaded its data: an element found by its role and its accessible name, or a sentence. */
export type Landmark =
  | { readonly role: 'heading' | 'table' | 'textbox' | 'checkbox' | 'link'; readonly name?: string }
  | { readonly text: string };

export interface Screen {
  /** The route of the router tree that draws it, by the id the router gives it (`/installations/$installationId`). */
  readonly route: string;
  /** Names the screen in a report and its baselines: letters, digits and hyphens. */
  readonly id: string;
  readonly path: string;
  readonly viewer: Viewer;
  readonly ready: Landmark;
  /** The answers of 4xx the screen is meant to get, which the browser logs as console errors: the tenant of someone else is a 404. */
  readonly refusals?: readonly Refusal[];
}

const heading = (name: string): Landmark => ({ role: 'heading', name });
const table = (name: string): Landmark => ({ role: 'table', name });

const tenant = `/installations/${String(TENANT.id)}`;
const sign = `/sign/${String(REPOSITORIES.widgets.githubId)}?pr=${String(SIGN_PR)}`;

/** Every screen that is photographed and checked, in the order of the router tree. */
export const SCREENS: readonly Screen[] = [
  {
    route: '__root__',
    id: 'not-found',
    path: '/no/such/page',
    viewer: 'alice',
    ready: heading(messages['states.notFound.title']),
  },
  { route: '/', id: 'landing', path: '/', viewer: 'alice', ready: { text: messages['landing.signedIn'] } },
  {
    route: '/',
    id: 'landing-visitor',
    path: '/',
    viewer: 'visitor',
    ready: { role: 'link', name: messages['auth.login'] },
  },
  {
    route: '/login/failed',
    id: 'login-failed',
    path: '/login/failed',
    viewer: 'visitor',
    ready: heading(messages['login.failed.title']),
  },
  { route: '/sign/$githubRepoId', id: 'sign-form', path: sign, viewer: 'frank', ready: { role: 'checkbox' } },
  {
    route: '/sign/$githubRepoId',
    id: 'sign-resign',
    path: sign,
    viewer: 'dan',
    ready: heading(messages['sign.resign.title']),
  },
  {
    route: '/sign/$githubRepoId',
    id: 'sign-signed',
    path: sign,
    viewer: 'carol',
    ready: heading(messages['sign.signed.title']),
  },
  {
    route: '/sign/$githubRepoId',
    id: 'sign-login',
    path: sign,
    viewer: 'visitor',
    ready: heading(messages['sign.login.title']),
  },
  {
    route: '/me/signatures',
    id: 'my-signatures',
    path: '/me/signatures',
    viewer: 'carol',
    ready: table(messages['me.signatures.caption']),
  },
  {
    route: '/installations',
    id: 'installations',
    path: '/installations',
    viewer: 'alice',
    ready: table(messages['installations.caption']),
  },
  {
    route: '/installations/$installationId',
    id: 'tenant',
    path: tenant,
    viewer: 'alice',
    ready: table(messages['installation.repositories.caption']),
  },
  {
    route: '/installations/$installationId/repositories',
    id: 'repositories',
    path: `${tenant}/repositories`,
    viewer: 'alice',
    ready: table(messages['repositories.caption']),
  },
  {
    route: '/installations/$installationId/documents',
    id: 'documents',
    path: `${tenant}/documents`,
    viewer: 'alice',
    ready: table(messages['documents.caption']),
  },
  {
    route: '/installations/$installationId/documents/$documentId',
    id: 'document-editor',
    path: `${tenant}/documents/9201`,
    viewer: 'alice',
    ready: { role: 'textbox', name: messages['editor.text.label'] },
  },
  {
    route: '/installations/$installationId/documents/$documentId',
    id: 'document-history',
    path: `${tenant}/documents/9201?tab=history`,
    viewer: 'alice',
    ready: table(messages['history.caption']),
  },
  {
    route: '/installations/$installationId/allowlist',
    id: 'allowlist',
    path: `${tenant}/allowlist`,
    viewer: 'alice',
    ready: table(messages['allowlist.caption']),
  },
  {
    route: '/installations/$installationId/signatures',
    id: 'signatures',
    path: `${tenant}/signatures`,
    viewer: 'alice',
    ready: table(messages['signatures.caption']),
  },
  {
    route: '/installations/$installationId/pending',
    id: 'pending',
    path: `${tenant}/pending`,
    viewer: 'alice',
    ready: table(messages['pending.caption']),
  },
  {
    route: '/installations/$installationId/pending',
    id: 'overrides',
    path: `${tenant}/pending?tab=overrides&repository=${String(REPOSITORIES.widgets.id)}`,
    viewer: 'alice',
    ready: table(messages['pending.overrides.caption']),
  },
  {
    route: '/installations/$installationId/audit',
    id: 'audit',
    path: `${tenant}/audit`,
    viewer: 'alice',
    ready: table(messages['audit.caption']),
  },
  {
    route: '/installations/$installationId/documents',
    id: 'foreign-tenant',
    path: `/installations/${String(FOREIGN_TENANT.id)}/documents`,
    viewer: 'alice',
    ready: { text: messages['errors.not_found'] },
    refusals: [{ status: 404, path: `/api/installations/${String(FOREIGN_TENANT.id)}`, within: true }],
  },
];

/**
 * The routes of the router that no screen above draws, each with the reason. The first-run setup exists only while no GitHub App is
 * configured, and the application under test is always configured; the home of a tenant is the repository list drawn at `tenant`.
 */
export const ROUTES_WITHOUT_SCREEN: ReadonlyMap<string, string> = new Map([
  [
    '/setup',
    'the first-run setup exists only while no GitHub App is configured (E19-S07); the application under test starts configured and is shown the not-found page there',
  ],
  ['/setup/callback', 'the return from GitHub of the first-run setup (E19-S07), reachable only in setup mode'],
  [
    '/operator/installations',
    'the operator screen (E18-S13) is for the person who operates the instance, and the application under test has no operator (no GitHub App and no OPERATOR_GITHUB_IDS), so it is the not-found page there; its screen is held by the unit tests and the route coverage guard',
  ],
  [
    '/installations/$installationId/',
    'the home of a tenant is the repository list of `/installations/$installationId`, which has a screen',
  ],
]);
