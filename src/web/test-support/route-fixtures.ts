// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { serveAllowlist } from '../allowlist/test-support.ts';
import { serveAudit } from '../audit/test-support.ts';
import { serveDocuments } from '../documents/test-support.ts';
import { messages } from '../i18n/index.ts';
import { globex, serveTenants, summary, tenantOf } from '../installations/test-support.ts';
import { item, serveOnePage } from '../me/test-support.ts';
import { servePending } from '../pending/test-support.ts';
import { CODE, STATE, serveSetup } from '../setup/test-support.ts';
import { serveSign } from '../sign/test-support.ts';
import { serveSignatures } from '../signatures/test-support.ts';

// The table of the route coverage guard (E18-S09): one entry for every route of the router tree, with the address it is rendered at, the
// made-up server it reads, and what to wait for before it is checked. The guard (src/web/route-coverage.test.tsx) renders each one, and
// fails when the tree has a route that this table does not list, so a story that adds a screen adds its entry here. All values are made up.

export interface RouteFixture {
  /** Where the route is rendered: a path with its query string. */
  readonly address: string;
  /** Puts the made-up server in place: the endpoints the route reads, with data on them. */
  readonly serve: () => void;
  /** Waits for the route to have drawn its data and not only its heading. */
  readonly ready: () => Promise<unknown>;
}

/** The installations of the person: `acme` (5), where they are an org admin, and `globex` (6), so the list does not open the only one. */
const serveInstallations = () => {
  serveTenants([tenantOf(summary(), 'acme/widgets', 'acme/gadgets'), tenantOf(globex(), 'globex/api')]);
};

const table = (caption: string) => () => screen.findByRole('table', { name: caption });

/**
 * The fixtures by route id, as the router names the routes. A `Map` and not an object, so a route id is never a property name. The
 * entries are in the order of the route tree.
 */
export const ROUTE_FIXTURES: ReadonlyMap<string, RouteFixture> = new Map<string, RouteFixture>([
  [
    '__root__',
    {
      address: '/no/such/page',
      serve: () => undefined,
      ready: () => screen.findByRole('heading', { level: 1, name: messages['states.notFound.title'] }),
    },
  ],
  [
    '/',
    {
      address: '/',
      serve: () => undefined,
      ready: () => screen.findByText(messages['landing.signedIn']),
    },
  ],
  [
    '/login/failed',
    {
      address: '/login/failed',
      serve: () => undefined,
      ready: () => screen.findByRole('heading', { level: 1, name: messages['login.failed.title'] }),
    },
  ],
  [
    '/setup',
    {
      address: '/setup',
      serve: () => {
        serveSetup();
      },
      ready: () => screen.findByLabelText(messages['setup.unlock.token']),
    },
  ],
  [
    '/setup/callback',
    {
      address: `/setup/callback?code=${CODE}&state=${STATE}`,
      serve: () => {
        serveSetup();
      },
      ready: () => screen.findByRole('button', { name: messages['setup.callback.get'] }),
    },
  ],
  [
    '/sign/$githubRepoId',
    {
      address: '/sign/123?pr=45',
      serve: () => {
        serveSign();
      },
      ready: () => screen.findByRole('checkbox'),
    },
  ],
  [
    '/me/signatures',
    {
      address: '/me/signatures',
      serve: () => {
        serveOnePage(item());
      },
      ready: table(messages['me.signatures.caption']),
    },
  ],
  [
    '/installations',
    { address: '/installations', serve: serveInstallations, ready: table(messages['installations.caption']) },
  ],
  [
    '/installations/$installationId',
    {
      address: '/installations/5',
      serve: serveInstallations,
      ready: table(messages['installation.repositories.caption']),
    },
  ],
  [
    '/installations/$installationId/',
    {
      address: '/installations/5',
      serve: serveInstallations,
      ready: table(messages['installation.repositories.caption']),
    },
  ],
  [
    '/installations/$installationId/documents',
    {
      address: '/installations/5/documents',
      serve: () => {
        serveDocuments();
      },
      ready: () => screen.findByRole('table'),
    },
  ],
  [
    '/installations/$installationId/documents/$documentId',
    {
      address: '/installations/5/documents/11',
      serve: () => {
        serveDocuments();
      },
      ready: () => screen.findByRole('textbox', { name: messages['editor.text.label'] }),
    },
  ],
  [
    '/installations/$installationId/allowlist',
    {
      address: '/installations/5/allowlist',
      serve: () => {
        serveAllowlist();
      },
      ready: table(messages['allowlist.caption']),
    },
  ],
  [
    '/installations/$installationId/signatures',
    {
      address: '/installations/5/signatures',
      serve: () => {
        serveSignatures();
      },
      ready: table(messages['signatures.caption']),
    },
  ],
  [
    '/installations/$installationId/pending',
    {
      address: '/installations/5/pending',
      serve: () => {
        servePending();
      },
      ready: table(messages['pending.caption']),
    },
  ],
  [
    '/installations/$installationId/audit',
    {
      address: '/installations/5/audit',
      serve: () => {
        serveAudit();
      },
      ready: table(messages['audit.caption']),
    },
  ],
]);
