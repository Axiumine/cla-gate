// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { http } from 'msw';
import { createElement } from 'react';
import type { z } from 'zod';
import { AUDIT_LOG_PATH, auditLogPageSchema } from '../../shared/audit-log.ts';
import { envelope, json, type Seen } from '../api/test-support.ts';
import { type Answer, endpoint, type PageAnswers, pagesEndpoint } from '../documents/test-support.ts';
import { messages } from '../i18n/index.ts';
import { serveTenants, summary, type Tenant, tenantOf } from '../installations/test-support.ts';
import { AppRouter } from '../router.tsx';
import { renderWithProviders } from '../test-support/render.tsx';
import { server } from '../test-support/server.ts';
import { ALICE } from '../test-support/session.ts';

// The server of the audit screen, as MSW answers for it in the tests of E18-S09: the audit log of the tenant and the installation
// screens' own endpoints (the list of installations, for the title and the navigation), every request recorded. The values are made up.

const eventItem = auditLogPageSchema.shape.items.element;

type EventInput = z.input<typeof eventItem>;

/**
 * An audit row as the endpoint sends it: event 12, the revocation of signature 9 by `octocat` (id 4711); `overrides` are put over it
 * and the contract is checked.
 */
export function eventOf(overrides: Partial<EventInput> = {}) {
  return eventItem.parse({
    id: 12,
    occurredAt: '2026-11-04T10:15:30.123Z',
    action: 'signature.revoked',
    actor: { githubId: 4711, login: 'octocat' },
    subject: { type: 'signature', id: 9 },
    metadata: { reason_code: 'legal_request', signature_id: 9 },
    ...overrides,
  });
}

/** An event no person caused: the installation was suspended on GitHub, so there is no actor and the metadata is empty. */
export const systemEventOf = (overrides: Partial<EventInput> = {}) =>
  eventOf({
    id: 11,
    occurredAt: '2026-11-03T08:00:00.000Z',
    action: 'installation.suspended',
    actor: null,
    subject: { type: 'installation', id: 5 },
    metadata: {},
    ...overrides,
  });

/** A page of the log as a response; `nextCursor` is `null` on the last page. */
export const pageOf = (items: readonly ReturnType<typeof eventOf>[], nextCursor: string | null = null): Response =>
  json(auditLogPageSchema.parse({ items, nextCursor }));

/** What the server answers when it has nothing under the id: the uniform `404` of every tenant route. */
export const notFound = (): Response => envelope(404, 'not_found');

/** What a test says the server answers; the answers are to the 1st, 2nd, ... request, and the last one repeats. */
export interface ServeAudit {
  readonly tenants?: readonly Tenant[];
  /** What `GET /api/installations` answers when it is not the summaries of `tenants`. */
  readonly listing?: () => Response | Promise<Response>;
  readonly log?: readonly Answer[];
  /** The pages of the log by cursor, `null` standing for the first page; a cursor with no page is a `400`. Used instead of `log`. */
  readonly pages?: PageAnswers;
}

/** Every request the screen made to the server. */
export interface ServedAudit {
  readonly log: Seen[];
  /** The requests of the installation screens: the list of installations and the repositories. */
  readonly tenants: ReturnType<typeof serveTenants>;
}

/**
 * Serves the audit log (and the installation screens' own, for the role: `acme` is installation 5, where the person is an org
 * admin) with the answers `serve` gives, or the defaults: the revocation and the suspension on one page.
 */
export function serveAudit(serve: ServeAudit = {}): ServedAudit {
  const served: ServedAudit = {
    log: [],
    tenants: serveTenants(serve.tenants ?? [tenantOf(summary(), 'acme/widgets')], serve.listing),
  };
  const log = serve.log ?? [pageOf([eventOf(), systemEventOf()])];
  server.use(
    http.get(
      AUDIT_LOG_PATH,
      serve.pages === undefined ? endpoint(served.log, log) : pagesEndpoint(served.log, serve.pages),
    ),
  );
  return served;
}

/** The app at `route`, signed in as the test user. */
export function renderAudit(route: string) {
  return renderWithProviders(createElement(AppRouter), { route, session: ALICE });
}

// What a test reads back from a recorded request: the same readers as the other screens.
export { cursorOf, paramsOf, pathOf } from '../documents/test-support.ts';

export const AUDIT_ROUTE = '/installations/5/audit';

/** The h1 of the app, once it is there. */
const heading = (name: string | RegExp) => screen.findByRole('heading', { level: 1, name });

/** The table of audit events. */
export const auditTable = () => screen.getByRole('table', { name: messages['audit.caption'] });

/** The rows of `table` under its header row. */
export const bodyRows = (table: HTMLElement): HTMLElement[] => within(table).getAllByRole('row').slice(1);

/** The cells of the rows of `table`, as text, header row left out. */
export const rowsOf = (table: HTMLElement): string[][] =>
  bodyRows(table).map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent));

/** The filter fields of the form. */
export const actionSelect = () => screen.getByRole('combobox', { name: messages['audit.filter.action'] });
export const actorField = () => screen.getByRole('textbox', { name: messages['audit.filter.actor'] });
export const subjectTypeField = () => screen.getByRole('textbox', { name: messages['audit.filter.subjectType'] });
export const subjectIdField = () => screen.getByRole('textbox', { name: messages['audit.filter.subjectId'] });
export const fromField = () => screen.getByRole('textbox', { name: messages['audit.filter.from'] });
export const toField = () => screen.getByRole('textbox', { name: messages['audit.filter.to'] });

/** The "Apply filters" and "Clear filters" buttons. */
export const applyButton = () => screen.getByRole('button', { name: messages['audit.filter.apply'] });
export const clearButton = () => screen.getByRole('button', { name: messages['audit.filter.clear'] });

/** The button that opens the metadata of event `id`. */
export const metadataButton = (id: number) =>
  screen.getByRole('button', { name: messages['audit.metadata.showLabel'].replace('{id}', String(id)) });

/** Opens the audit log at `route` and waits for the rows to be there. */
export async function openAudit(route: string = AUDIT_ROUTE, serve: ServeAudit = {}) {
  const served = serveAudit(serve);
  const rendered = renderAudit(route);
  await heading(messages['audit.title']);
  await screen.findByRole('table', { name: messages['audit.caption'] });
  return { served, ...rendered };
}
