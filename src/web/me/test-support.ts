// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { createElement } from 'react';
import { assert } from 'vitest';
import type { z } from 'zod';
import { type DataExport, dataExportRoute, dataExportSchema } from '../../shared/data-export.ts';
import {
  OWN_SIGNATURES_PATH,
  type OwnSignaturesPage,
  ownSignatureSchema,
  ownSignaturesPageSchema,
} from '../../shared/own-signatures.ts';
import { answer, json, type Seen } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { AppRouter } from '../router.tsx';
import { renderWithProviders } from '../test-support/render.tsx';
import { server } from '../test-support/server.ts';
import { ALICE } from '../test-support/session.ts';

// The server of the "my signatures" screen, as MSW answers for it in the tests of E18-S03: pages of a person's own signatures
// by cursor, each request recorded, and the data export. All values are made up.

type ItemInput = z.input<typeof ownSignatureSchema>;
export type Item = OwnSignaturesPage['items'][number];

/** An active signature of the made-up person in the org `acme`, signed from pull request 45 of `acme/widgets`. */
const ACTIVE: ItemInput = {
  id: 900,
  installation: { accountLogin: 'acme', accountType: 'Organization', suspended: false },
  document: { id: 7, name: 'Individual CLA' },
  version: { id: 31, major: 2, minor: 1 },
  signedAt: '2026-11-02T09:30:00.000Z',
  source: { repositoryFullName: 'acme/widgets', prNumber: 45 },
  state: 'active',
  revokedAt: null,
  resignPath: null,
};

/** A signature as the endpoint sends it: `overrides` are put over an active one and the contract is checked. */
export function item(overrides: Partial<ItemInput> = {}): Item {
  return ownSignatureSchema.parse({ ...ACTIVE, ...overrides });
}

/** A signature that a later major version replaced: the person can sign the repository `123` again. */
export function outdated(overrides: Partial<ItemInput> = {}): Item {
  return item({ id: 901, state: 'outdated', resignPath: '/sign/123', ...overrides });
}

/** A signature that was revoked on 2026-11-03: the person can sign the repository `123` again. */
export function revoked(overrides: Partial<ItemInput> = {}): Item {
  return item({
    id: 902,
    state: 'revoked',
    revokedAt: '2026-11-03T08:15:00.000Z',
    resignPath: '/sign/123',
    ...overrides,
  });
}

/** A page of the list as a response; `nextCursor` is `null` on the last page. */
export function pageOf(items: readonly Item[], nextCursor: string | null = null): Response {
  return json(ownSignaturesPageSchema.parse({ items, nextCursor }));
}

/** What the server answers for a cursor, `null` standing for the first page. */
type Answer = () => Response | Promise<Response>;

/** What the server answers for each cursor. A cursor it has no answer for is a `400`. */
export type Pages = readonly (readonly [cursor: string | null, answer: Answer])[];

/** The `400` the server answers for a cursor it did not make. */
export function refusedCursor(): Response {
  return HttpResponse.json(
    { error: { code: 'bad_request', message: 'x', requestId: 'req-00000001' } },
    { status: 400 },
  );
}

/** Answers the list by cursor, and records each request. */
export function serveSignatures(pages: Pages): Seen[] {
  const answers = new Map(pages);
  const seen: Seen[] = [];
  server.use(
    http.get(OWN_SIGNATURES_PATH, async ({ request }) => {
      seen.push({ method: request.method, url: request.url, headers: Object.fromEntries(request.headers), text: '' });
      const page = answers.get(new URL(request.url).searchParams.get('cursor'));
      return page === undefined ? refusedCursor() : await page();
    }),
  );
  return seen;
}

/** Serves one page, the first and last. */
export function serveOnePage(...items: Item[]): Seen[] {
  return serveSignatures([[null, () => pageOf(items)]]);
}

/** The `cursor` parameter of a recorded request: `null` when it names none. */
export const cursorOf = (request: Seen): string | null => new URL(request.url).searchParams.get('cursor');

/** The names of the query parameters of a recorded request. */
export const parametersOf = (request: Seen): string[] => [...new URL(request.url).searchParams.keys()];

/** The exact personal address that the export of the fixture holds: `zzzz` cannot appear in a hexadecimal request id. */
export const EXPORTED_EMAIL = 'zzzz-person@example.org';

/** The document `GET /api/me/export` sends for the made-up person of the session: one signature with personal data. */
export function exportDocument(): DataExport {
  return dataExportSchema.parse({
    schemaVersion: 1,
    exportedAt: '2026-11-04T10:00:00.000Z',
    user: { githubId: 4711, login: 'octocat', name: 'The Octocat', createdAt: '2026-10-01T10:00:00.000Z' },
    signatures: [
      {
        id: 900,
        installation: { githubInstallationId: 5, accountLogin: 'acme' },
        document: { id: 7, name: 'Individual CLA' },
        version: { id: 31, major: 2, minor: 1, contentSha256: '0123456789abcdef'.repeat(4) },
        consentTextId: 'individual-v1',
        signerType: 'individual',
        signedAt: '2026-11-02T09:30:00.000Z',
        source: { repositoryFullName: 'acme/widgets', prNumber: 45 },
        revokedAt: null,
        revokeReasonCode: null,
        personalData: {
          name: 'Ada Lovelace',
          email: EXPORTED_EMAIL,
          login: 'octocat',
          ipAddress: null,
          userAgent: null,
        },
      },
    ],
    allowlistEntries: [],
    auditEntries: [],
    truncated: false,
  });
}

/** Answers the export with `responses` in turn, the last one again, and records each request. */
export function serveExport(...responses: Response[]): Seen[] {
  return answer(dataExportRoute.path, ...responses);
}

/** An export that is answered when the test says so: `release` sends the answer, and `received` lists what arrived. */
export function serveHeldExport(): { readonly received: Seen[]; readonly release: (response: Response) => void } {
  const received: Seen[] = [];
  const { promise: held, resolve: release } = Promise.withResolvers<Response>();
  server.use(
    http.get(dataExportRoute.path, async ({ request }) => {
      received.push({ method: request.method, url: request.url, headers: {}, text: await request.text() });
      return (await held).clone();
    }),
  );
  return { received, release };
}

/** The app at `route`, signed in as the test user. */
export function renderMine(route = '/me/signatures') {
  return renderWithProviders(createElement(AppRouter), { route, session: ALICE });
}

/** The app on the screen, once its one h1 is there. */
export async function openMine(route = '/me/signatures') {
  const rendered = renderMine(route);
  await screen.findByRole('heading', { level: 1, name: messages['me.signatures.title'] });
  return rendered;
}

/** The app on the screen, once the table of signatures is there. */
export async function openList(route = '/me/signatures') {
  const rendered = await openMine(route);
  await screen.findByRole('table', { name: messages['me.signatures.caption'] });
  return rendered;
}

/** The table of signatures. */
export const signaturesTable = () => screen.getByRole('table', { name: messages['me.signatures.caption'] });

/** The body rows of the table, in the order they are drawn. */
export const bodyRows = () => within(signaturesTable()).getAllByRole('row').slice(1);

/** The columns of the table, left to right. */
const COLUMNS = ['document', 'organisation', 'version', 'signed', 'source', 'status'] as const;

/** The cell of `column` in the row that shows the document `name`. */
export function cellOf(name: string, column: (typeof COLUMNS)[number]): HTMLElement {
  const row = screen.getByRole('row', { name: (rowName) => rowName.startsWith(name) });
  const cell = within(row).getAllByRole('cell')[COLUMNS.indexOf(column)];
  assert.isDefined(cell, `the row of ${name} has no ${column} cell`);
  return cell;
}
