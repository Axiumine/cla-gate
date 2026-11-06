// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import { createElement } from 'react';
import { expect } from 'vitest';
import type { z } from 'zod';
import { REPOSITORY_DOCUMENTS_PATH, repositoryDocumentsResponseSchema } from '../../shared/cla.ts';
import {
  attachedDocumentSchema,
  INSTALLATION_REPOSITORIES_PATH,
  type RepositoryPage,
  repositoryPageSchema,
} from '../../shared/installations.ts';
import { REPOSITORY_CLA_DOCUMENT_PATH, repositoryDocumentResponseSchema } from '../../shared/repository-document.ts';
import {
  REPOSITORY_DISABLE_PATH,
  REPOSITORY_ENABLE_PATH,
  repositoryEnabledResponseSchema,
} from '../../shared/repository-enabled.ts';
import { envelope, json, type Seen } from '../api/test-support.ts';
import { type Answer, endpoint } from '../documents/test-support.ts';
import { messages } from '../i18n/index.ts';
import { repository, serveTenants, summary, type Tenant, tenantOf } from '../installations/test-support.ts';
import { AppRouter } from '../router.tsx';
import { renderWithProviders } from '../test-support/render.tsx';
import { server } from '../test-support/server.ts';
import { ALICE } from '../test-support/session.ts';

// The server of the Repositories screen, as MSW answers for it in the tests of E18-S10: the list of repositories of a tenant, the documents a
// repository may enforce, the attach and detach of a document, and the enable and the disable of the check, every request recorded.
// The values are made up.

type AttachedInput = z.input<typeof attachedDocumentSchema>;
type RepositoryInput = Parameters<typeof repository>[2];

/** The document `Individual CLA` (id 11, the whole installation) at 1.0, as a list shows the document a repository enforces. */
export function claOf(overrides: Partial<AttachedInput> = {}) {
  return attachedDocumentSchema.parse({
    id: 11,
    name: 'Individual CLA',
    scope: 'installation',
    activeVersion: { major: 1, minor: 0 },
    ...overrides,
  });
}

/** `acme/widgets` (repository 1): enforcing `Individual CLA` 1.0. */
export const widgets = (overrides: RepositoryInput = {}) =>
  repository(1, 'acme/widgets', { enabled: true, document: claOf(), ...overrides });

/** `acme/gadgets` (repository 2): not enforcing, with no document. */
export const gadgets = (overrides: RepositoryInput = {}) =>
  repository(2, 'acme/gadgets', { enabled: false, document: null, ...overrides });

/** A page of repositories as a response; `nextCursor` is `null` on the last page. */
export const pageOf = (items: RepositoryPage['items'], nextCursor: string | null = null): Response =>
  json(repositoryPageSchema.parse({ items, nextCursor }));

/** A document of the whole installation that a repository may enforce, as the documents of a repository list it. */
export const installationDocument = (id: number, name: string, version: { major: number; minor: number } | null) => ({
  id,
  name,
  activeVersion: version,
});

/** A document scoped to repository 2, as the documents of a repository list it (never with a text). */
export const repositoryDocument = (id: number, name: string, version: { major: number; minor: number } | null) => ({
  id,
  name,
  kind: 'individual' as const,
  scope: 'repository' as const,
  repositoryId: 2,
  activeVersion:
    version === null
      ? null
      : { id: id * 10, ...version, contentSha256: 'a'.repeat(64), publishedAt: '2026-10-01T09:30:00.000Z' },
  createdAt: '2026-09-01T09:30:00.000Z',
  updatedAt: '2026-10-01T09:30:00.000Z',
});

type DocumentsInput = z.input<typeof repositoryDocumentsResponseSchema>;

/** The answer of `GET .../repositories/:repositoryId/documents`. */
export const documentsOf = (documents: Partial<DocumentsInput> = {}): Response =>
  json(
    repositoryDocumentsResponseSchema.parse({
      repositoryScoped: [],
      installationScoped: [installationDocument(11, 'Individual CLA', { major: 1, minor: 0 })],
      ...documents,
    }),
  );

/** The `200` of an attach (`documentId`) or a detach (`null`); `changed: false` is the answer to a call that asked for what already was. */
export const attachedAs = (documentId: number | null, changed = true): Response =>
  json(repositoryDocumentResponseSchema.parse({ documentId, changed }));

/** The `200` of an enable or a disable: whether the repository enforces now and whether the call changed it. */
export const switchedTo = (enabled: boolean, changed = true): Response =>
  json(repositoryEnabledResponseSchema.parse({ enabled, changed }));

/** A rule of the API: the status and code of its error body. */
export const rule = (status: number, code: string): Response => envelope(status, code);

/** What the server answers when it has nothing under the id: the uniform `404` of every tenant route. */
export const notFound = (): Response => envelope(404, 'not_found');

/** What the list is asked for: the address of the request and the installation in its path. */
interface ListRequest {
  readonly url: URL;
  readonly installationId: number;
}

/** What a test says the server answers; each list is the answers to the 1st, 2nd, ... request, and the last one repeats. */
export interface ServeRepositories {
  readonly tenants?: readonly Tenant[];
  /** What `GET /api/installations` answers when it is not the summaries of `tenants`. */
  readonly listing?: () => Response | Promise<Response>;
  readonly list?: readonly Answer[];
  /** The page for the request, by its search and its installation. Used instead of `list`. */
  readonly byRequest?: (request: ListRequest) => Response | Promise<Response>;
  readonly documents?: readonly Answer[];
  readonly attach?: readonly Answer[];
  readonly enable?: readonly Answer[];
  readonly disable?: readonly Answer[];
}

/** Every request the screen made to the server, in order, by endpoint. */
export interface ServedRepositories {
  readonly list: Seen[];
  readonly documents: Seen[];
  readonly attach: Seen[];
  readonly enable: Seen[];
  readonly disable: Seen[];
  /** The requests of the installation list. */
  readonly tenants: ReturnType<typeof serveTenants>;
}

/** The default answers: both repositories on one page, the one document of the installation, and a change of each kind. */
function defaults() {
  return {
    list: [pageOf([widgets(), gadgets()])],
    documents: [documentsOf()],
    attach: [attachedAs(11)],
    enable: [switchedTo(true)],
    disable: [switchedTo(false)],
  };
}

/** The handler of the list: it records the request and answers it by its request, or with the answer for its turn. */
function listEndpoint(seen: Seen[], serve: ServeRepositories, answers: readonly Answer[]) {
  const ordered = endpoint(seen, answers);
  return async (info: { readonly request: Request; readonly params: Readonly<Record<string, unknown>> }) => {
    if (serve.byRequest === undefined) {
      return await ordered(info);
    }
    seen.push({
      method: info.request.method,
      url: info.request.url,
      headers: Object.fromEntries(info.request.headers),
      text: '',
    });
    return await serve.byRequest({
      url: new URL(info.request.url),
      installationId: Number(info.params['installationId']),
    });
  };
}

/**
 * Serves the repository endpoints (and the list of installations, for the role and the suspended flag: installation 5 is `acme`, where the
 * person is an org admin) with the answers `serve` gives, or the defaults. `acme/widgets` is repository 1 and `acme/gadgets` repository 2.
 */
export function serveRepositories(serve: ServeRepositories = {}): ServedRepositories {
  const answers = { ...defaults(), ...serve };
  const served: ServedRepositories = {
    list: [],
    documents: [],
    attach: [],
    enable: [],
    disable: [],
    tenants: serveTenants(serve.tenants ?? [tenantOf(summary())], serve.listing),
  };
  server.use(
    http.get(INSTALLATION_REPOSITORIES_PATH, listEndpoint(served.list, serve, answers.list)),
    http.get(REPOSITORY_DOCUMENTS_PATH, endpoint(served.documents, answers.documents)),
    http.put(REPOSITORY_CLA_DOCUMENT_PATH, endpoint(served.attach, answers.attach)),
    http.post(REPOSITORY_ENABLE_PATH, endpoint(served.enable, answers.enable)),
    http.post(REPOSITORY_DISABLE_PATH, endpoint(served.disable, answers.disable)),
  );
  return served;
}

/** The app at `route`, signed in as the test user. */
export function renderRepositories(route: string) {
  return renderWithProviders(createElement(AppRouter), { route, session: ALICE });
}

export const REPOSITORIES_ROUTE = '/installations/5/repositories';

/** The h1 of the app, once it is there. */
export const heading = (name: string | RegExp) => screen.findByRole('heading', { level: 1, name });

/** The table of repositories. */
export const repositoriesTable = () => screen.getByRole('table', { name: messages['repositories.caption'] });

/** The cells of the rows of `table`, as text, header row left out. */
export const rowsOf = (table: HTMLElement): string[][] =>
  within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent));

/** The row of the table whose first cell is `name`. */
export const rowOf = (name: string): HTMLElement =>
  within(repositoriesTable()).getByRole('row', {
    name: (_accessibleName, row) => row.querySelector('td')?.textContent === name,
  });

/** The query parameters of a recorded request, as an object: the names the screen sent and nothing else. */
export const paramsOf = (seen: Seen | undefined): Record<string, string> =>
  Object.fromEntries(new URL(String(seen?.url)).searchParams);

/** The path of a request. */
export const pathOf = (seen: Seen | undefined): string => new URL(String(seen?.url)).pathname;

/** The JSON a request carried, as the server read it. */
export const bodyOf = (seen: Seen | undefined): unknown => JSON.parse(String(seen?.text));

/** The search box of the page, the enforcement filter. */
export const searchBox = () =>
  screen.getByRole<HTMLInputElement>('searchbox', { name: messages['repositories.search.field'] });
export const enabledFilter = () => screen.getByRole('combobox', { name: messages['repositories.filter.enabled'] });

/** The "Enable" button of the repository `name`. */
export const enableButton = (name: string) =>
  screen.getByRole('button', { name: messages['repositories.enable.label'].replace('{repository}', name) });

/** The "Disable" button of the repository `name`, and the question it opens. */
export const disableButton = (name: string) =>
  screen.getByRole('button', { name: messages['repositories.disable.label'].replace('{repository}', name) });
export const disableDialog = () => screen.getByRole('alertdialog');
export const confirmDisable = () =>
  within(disableDialog()).getByRole('button', { name: messages['repositories.disable.confirm'] });

/** The "Attach CLA" button of the repository `name` (or "Change CLA" when it has a document), and the dialog it opens. */
export const attachButton = (name: string) =>
  screen.getByRole('button', { name: messages['repositories.attach.label'].replace('{repository}', name) });
export const changeButton = (name: string) =>
  screen.getByRole('button', { name: messages['repositories.attach.changeLabel'].replace('{repository}', name) });
export const attachDialog = () => screen.getByRole('dialog');
export const documentSelect = () =>
  within(attachDialog()).getByRole('combobox', { name: messages['repositories.attach.field'] });
export const saveButton = () =>
  within(attachDialog()).getByRole('button', { name: messages['repositories.attach.submit'] });

/** Opens the Repositories screen at `route` and waits for the rows (or the state that stands in for them) to be there. */
export async function openRepositories(route: string = REPOSITORIES_ROUTE, serve: ServeRepositories = {}) {
  const served = serveRepositories(serve);
  const rendered = renderRepositories(route);
  await heading(messages['repositories.title']);
  await screen.findByRole('heading', { level: 2, name: messages['repositories.results.title'] });
  await waitFor(() => {
    expect(screen.queryByText(messages['states.loading'])).toBeNull();
  });
  return { served, ...rendered };
}
