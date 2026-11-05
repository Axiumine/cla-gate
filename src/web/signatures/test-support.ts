// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { http } from 'msw';
import { createElement } from 'react';
import type { z } from 'zod';
import { DOCUMENTS_PATH } from '../../shared/cla.ts';
import { SIGNATURES_CSV_PATH } from '../../shared/signature-export.ts';
import { SIGNATURE_REVOKE_PATH, signatureRevokeResponseSchema } from '../../shared/signature-revoke.ts';
import { SIGNATURES_PATH, signatureSearchPageSchema } from '../../shared/signature-search.ts';
import { envelope, json, type Seen } from '../api/test-support.ts';
import { type Answer, endpoint, listedOf, listOf } from '../documents/test-support.ts';
import { messages } from '../i18n/index.ts';
import { serveTenants, summary, type Tenant, tenantOf } from '../installations/test-support.ts';
import { AppRouter } from '../router.tsx';
import { renderWithProviders } from '../test-support/render.tsx';
import { server } from '../test-support/server.ts';
import { ALICE } from '../test-support/session.ts';

// The server of the signatures screen, as MSW answers for it in the tests of E18-S07: the search, the revocation, the documents of
// the tenant and the CSV export, every request recorded. The values are made up.

const listedSignature = signatureSearchPageSchema.shape.items.element;

type SignatureInput = z.input<typeof listedSignature>;

/** The email of the made-up signer: `zzzz` cannot appear in a hexadecimal request id, so a test that looks for it is not fooled by one. */
export const EMAIL = 'zzzz-ada@example.org';

/** A signature as the search sends it: Ada Lovelace (login `octocat`, id 4711) signed document 11 at version 2.1 from pull request 45 of `acme/widgets`; `overrides` are put over it and the contract is checked. */
export function signatureOf(overrides: Partial<SignatureInput> = {}) {
  return listedSignature.parse({
    id: 900,
    githubUserId: 4711,
    document: { id: 11, name: 'Individual CLA' },
    version: { major: 2, minor: 1 },
    signedAt: '2026-11-02T09:30:00.000Z',
    source: { repositoryFullName: 'acme/widgets', prNumber: 45 },
    state: 'active',
    revokedAt: null,
    revokedByGithubId: null,
    revokeReasonCode: null,
    signer: { login: 'octocat', name: 'Ada Lovelace', email: EMAIL },
    piiErased: false,
    ...overrides,
  });
}

/** A signature of someone else, by id, name and login: Grace Hopper of repository `acme/gadgets`, document 12. */
export const graceOf = (overrides: Partial<SignatureInput> = {}) =>
  signatureOf({
    id: 901,
    githubUserId: 583231,
    document: { id: 12, name: 'Widgets CLA' },
    signedAt: '2026-11-01T08:00:00.000Z',
    source: { repositoryFullName: 'acme/gadgets', prNumber: null },
    signer: { login: 'defunkt', name: 'Grace Hopper', email: 'zzzz-grace@example.org' },
    ...overrides,
  });

/** A signature that was revoked on 2026-11-03 by the person with the id 4712, for the reason `legal_request`. */
export const revokedOf = (overrides: Partial<SignatureInput> = {}) =>
  signatureOf({
    id: 902,
    state: 'revoked',
    revokedAt: '2026-11-03T08:15:00.000Z',
    revokedByGithubId: 4712,
    revokeReasonCode: 'legal_request',
    ...overrides,
  });

/** A signature whose personal data was erased: the signer is gone and the identity key stays. */
export const erasedOf = (overrides: Partial<SignatureInput> = {}) =>
  signatureOf({ id: 903, githubUserId: 9001, signer: null, piiErased: true, ...overrides });

/** A page of the search as a response; `nextCursor` is `null` on the last page. */
export const pageOf = (
  items: readonly ReturnType<typeof signatureOf>[],
  nextCursor: string | null = null,
  truncated = false,
): Response => json(signatureSearchPageSchema.parse({ items, nextCursor, truncated }));

/** The `200` of a revocation. */
export const revokedAs = (id: number, reevaluating = 0): Response =>
  json(
    signatureRevokeResponseSchema.parse({
      signature: { id, state: 'revoked', revokedAt: '2026-11-04T10:00:00.000Z' },
      reevaluating,
    }),
  );

/** What a test says the server answers; each list is the answers to the 1st, 2nd, ... request, and the last one repeats. */
export interface ServeSignatures {
  readonly tenants?: readonly Tenant[];
  /** What `GET /api/installations` answers when it is not the summaries of `tenants`. */
  readonly listing?: () => Response | Promise<Response>;
  readonly search?: readonly Answer[];
  /** The pages of the search by cursor, `null` standing for the first page; a cursor with no page is a `400`. Used instead of `search`. */
  readonly pages?: ReadonlyMap<string | null, () => Response | Promise<Response>>;
  readonly revoke?: readonly Answer[];
  /** The documents of the installation, as `GET .../documents` answers. */
  readonly documents?: readonly Answer[];
  readonly csv?: readonly Answer[];
}

/** Every request the screen made to the server, in order, by endpoint. */
export interface ServedSignatures {
  readonly search: Seen[];
  readonly revoke: Seen[];
  readonly documents: Seen[];
  readonly csv: Seen[];
  /** The requests of the installation screens: the list of installations and the repositories. */
  readonly tenants: ReturnType<typeof serveTenants>;
}

/** A file the export sends: the CSV with the headers the server writes. */
export const csvFile = (name = 'signatures-11-2026-11-04.csv'): Response =>
  new Response('signature_id,github_user_id\r\n900,4711\r\n', {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"` },
  });

/** The default answers: Ada and Grace on one page, a revocation of 900, the two documents of the made-up tenant, and the file. */
function defaults() {
  return {
    search: [pageOf([signatureOf(), graceOf()])],
    revoke: [revokedAs(900)],
    documents: [
      listOf(
        listedOf({ id: 11, name: 'Individual CLA' }),
        listedOf({
          id: 12,
          name: 'Widgets CLA',
          scope: 'repository',
          repositoryId: 1,
          repositoryFullName: 'acme/widgets',
        }),
      ),
    ],
    csv: [csvFile()],
  };
}

/**
 * Serves the signatures endpoints (and the installation screens' own, for the role, the suspended flag and the repositories) with the
 * answers `serve` gives, or the defaults.
 */
export function serveSignatures(serve: ServeSignatures = {}): ServedSignatures {
  const answers = { ...defaults(), ...serve };
  const served: ServedSignatures = {
    search: [],
    revoke: [],
    documents: [],
    csv: [],
    tenants: serveTenants(serve.tenants ?? [tenantOf(summary(), 'acme/widgets', 'acme/gadgets')], serve.listing),
  };
  const { pages } = serve;
  const search =
    pages === undefined
      ? endpoint(served.search, answers.search)
      : async ({ request }: { readonly request: Request }) => {
          served.search.push({
            method: request.method,
            url: request.url,
            headers: Object.fromEntries(request.headers),
            text: '',
          });
          const page = pages.get(new URL(request.url).searchParams.get('cursor'));
          return page === undefined ? envelope(400, 'bad_request') : await page();
        };
  server.use(
    http.get(SIGNATURES_PATH, search),
    http.post(SIGNATURE_REVOKE_PATH, endpoint(served.revoke, answers.revoke)),
    http.get(DOCUMENTS_PATH, endpoint(served.documents, answers.documents)),
    http.get(SIGNATURES_CSV_PATH, endpoint(served.csv, answers.csv)),
  );
  return served;
}

/** What the server answers when it has nothing under the id: the uniform `404` of every tenant route. */
export const notFound = (): Response => envelope(404, 'not_found');

/** The app at `route`, signed in as the test user. */
export function renderSignatures(route: string) {
  return renderWithProviders(createElement(AppRouter), { route, session: ALICE });
}

export const SIGNATURES_ROUTE = '/installations/5/signatures';

/** The h1 of the app, once it is there. */
export const heading = (name: string | RegExp) => screen.findByRole('heading', { level: 1, name });

/** The table of signatures. */
export const signaturesTable = () => screen.getByRole('table', { name: messages['signatures.caption'] });

/** The cells of the rows of `table`, as text, header row left out. */
export const rowsOf = (table: HTMLElement): string[][] =>
  within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent));

/** The `cursor` parameter of a recorded request: `null` when it names none. */
export const cursorOf = (seen: Seen | undefined): string | null =>
  new URL(String(seen?.url)).searchParams.get('cursor');

/** The query parameters of a recorded request, as an object: the names the screen sent and nothing else. */
export const paramsOf = (seen: Seen | undefined): Record<string, string> =>
  Object.fromEntries(new URL(String(seen?.url)).searchParams);

/** The path of a request. */
export const pathOf = (seen: Seen | undefined): string => new URL(String(seen?.url)).pathname;

/** The JSON a request carried, as the server read it. */
export const bodyOf = (seen: Seen | undefined): unknown => JSON.parse(String(seen?.text));

/** The search box. */
export const searchBox = () => screen.getByRole('searchbox', { name: messages['signatures.search.field'] });

/** The status select. */
export const stateSelect = () => screen.getByRole('combobox', { name: messages['signatures.filter.state'] });

/** The document select. */
export const documentSelect = () => screen.getByRole('combobox', { name: messages['signatures.filter.document'] });

/** The "Revoke" button of the row of the signer called `name`. */
export const revokeButton = (name: string) =>
  screen.getByRole('button', { name: messages['signatures.revoke.label'].replace('{signer}', name) });

/** The "Details" button of the row of the signer called `name`. */
export const detailsButton = (name: string) =>
  screen.getByRole('button', { name: messages['signatures.details.label'].replace('{signer}', name) });

/** The question of the revocation, once it is open. */
export const revokeDialog = () => screen.getByRole('alertdialog');

/** The reason select of the revoke question. */
export const reasonSelect = () => within(revokeDialog()).getByRole('combobox', { name: /^Reason/ });

/** The confirm button of the revoke question. */
export const confirmButton = () =>
  within(revokeDialog()).getByRole('button', { name: messages['signatures.revoke.confirm'] });

/** The "Export CSV" link. */
export const exportLink = () => screen.getByRole('link', { name: messages['signatures.export'] });

/** Opens the signatures at `route` and waits for the rows to be there. */
export async function openSignatures(route: string = SIGNATURES_ROUTE, serve: ServeSignatures = {}) {
  const served = serveSignatures(serve);
  const rendered = renderSignatures(route);
  await heading(messages['signatures.title']);
  await screen.findByRole('table', { name: messages['signatures.caption'] });
  return { served, ...rendered };
}
