// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { http } from 'msw';
import { createElement } from 'react';
import type { z } from 'zod';
import {
  ALLOWLIST_ENTRY_PATH,
  allowlistEntryResponseSchema,
  allowlistPageSchema,
  INSTALLATION_ALLOWLIST_PATH,
  REPOSITORY_ALLOWLIST_PATH,
  repositoryAllowlistPageSchema,
} from '../../shared/allowlist.ts';
import { REPOSITORY_DOCUMENTS_PATH } from '../../shared/cla.ts';
import { envelope, json, type Seen } from '../api/test-support.ts';
import { type Answer, endpoint } from '../documents/test-support.ts';
import { messages } from '../i18n/index.ts';
import { serveTenants, summary, type Tenant, tenantOf } from '../installations/test-support.ts';
import { documentsOf } from '../repositories/test-support.ts';
import { AppRouter } from '../router.tsx';
import { renderWithProviders } from '../test-support/render.tsx';
import { server } from '../test-support/server.ts';
import { ALICE } from '../test-support/session.ts';

// The server of the allowlist screen, as MSW answers for it in the tests of E18-S06: the two lists, the two adds and the removal, every
// request recorded. The values are made up.

const listedEntry = allowlistPageSchema.shape.entries.element;

type EntryInput = z.input<typeof listedEntry>;
type Entries = z.infer<typeof allowlistPageSchema>['entries'];

/** An entry as the lists send it: the user `defunkt`, added to the whole installation by `alice`; `overrides` are put over it and the contract is checked. */
export function entryOf(overrides: Partial<EntryInput> = {}) {
  return listedEntry.parse({
    id: 1,
    scope: 'installation',
    repositoryId: null,
    kind: 'user',
    githubId: 583231,
    loginSnapshot: 'defunkt',
    createdBy: { githubId: 4711, login: 'alice' },
    createdAt: '2026-10-01T09:30:00.000Z',
    readOnly: false,
    ...overrides,
  });
}

/** An entry of the repository with the id 1 (`acme/widgets` of the default tenant). */
export const repositoryEntryOf = (overrides: Partial<EntryInput> = {}) =>
  entryOf({ scope: 'repository', repositoryId: 1, ...overrides });

/** An entry that a repository inherits from its installation: read-only. */
export const inheritedOf = (overrides: Partial<EntryInput> = {}) => entryOf({ readOnly: true, ...overrides });

/** The answer of `GET .../installations/:installationId/allowlist-entries`. */
export const installationPage = (entries: Entries, nextCursor: string | null = null): Response =>
  json(allowlistPageSchema.parse({ entries, nextCursor }));

/** The answer of `GET .../repositories/:repositoryId/allowlist-entries`. */
export const repositoryPage = (own: Entries, inherited: Entries = [], nextCursor: string | null = null): Response =>
  json(repositoryAllowlistPageSchema.parse({ own, inherited, nextCursor }));

/** The `201` of an add: the entry that was made, as the add tells it (without the login of the person who made it). */
export function storedAs(overrides: Partial<EntryInput> = {}): Response {
  const entry = entryOf({ id: 90, ...overrides });
  return json(
    allowlistEntryResponseSchema.parse({ entry: { ...entry, createdBy: { githubId: entry.createdBy.githubId } } }),
    201,
  );
}

/** What a rule of the add answers: its code, with `422` unless the rule is a conflict. */
export const refused = (code: string, status = 422): Response => envelope(status, code);

/** What a test says the server answers; each list is the answers to the 1st, 2nd, ... request, and the last one repeats. */
export interface ServeAllowlist {
  readonly tenants?: readonly Tenant[];
  /** What `GET /api/installations` answers when it is not the summaries of `tenants`. */
  readonly listing?: () => Response | Promise<Response>;
  readonly installationList?: readonly Answer[];
  readonly repositoryList?: readonly Answer[];
  /** The answers to the check that a repository belongs to the installation in the address (`GET .../repositories/:repositoryId/documents`). */
  readonly membership?: readonly Answer[];
  /** The answers to an add, whichever scope it is for. */
  readonly add?: readonly Answer[];
  readonly remove?: readonly Answer[];
}

/** Every request the screen made to the server, in order, by endpoint. */
export interface ServedAllowlist {
  readonly installationList: Seen[];
  readonly repositoryList: Seen[];
  /** The checks that a repository belongs to the installation in the address. */
  readonly membership: Seen[];
  readonly addInstallation: Seen[];
  readonly addRepository: Seen[];
  readonly remove: Seen[];
  /** The requests of the installation screens: the list of installations and the repositories. */
  readonly tenants: ReturnType<typeof serveTenants>;
}

// What a test reads back from a recorded request: the same readers as the other screens.
export { bodyOf, pathOf } from '../documents/test-support.ts';

/** The default answers: one user on the installation list; one entry of the repository and one inherited; an add that stores `defunkt`; a removal. */
function defaults() {
  return {
    installationList: [installationPage([entryOf()])],
    repositoryList: [
      repositoryPage(
        [repositoryEntryOf({ id: 2, loginSnapshot: 'hubot', githubId: 77 })],
        [inheritedOf({ id: 3, loginSnapshot: 'monalisa', githubId: 88 })],
      ),
    ],
    membership: [documentsOf()],
    add: [storedAs()],
    remove: [new Response(null, { status: 204 })],
  };
}

/**
 * Serves the allowlist endpoints (and the installation screens' own, for the role, the suspended flag and the repositories of the scope
 * choice) with the answers `serve` gives, or the defaults.
 */
export function serveAllowlist(serve: ServeAllowlist = {}): ServedAllowlist {
  const answers = { ...defaults(), ...serve };
  const served: ServedAllowlist = {
    installationList: [],
    repositoryList: [],
    membership: [],
    addInstallation: [],
    addRepository: [],
    remove: [],
    tenants: serveTenants(serve.tenants ?? [tenantOf(summary(), 'acme/widgets', 'acme/gadgets')], serve.listing),
  };
  server.use(
    http.get(INSTALLATION_ALLOWLIST_PATH, endpoint(served.installationList, answers.installationList)),
    http.get(REPOSITORY_ALLOWLIST_PATH, endpoint(served.repositoryList, answers.repositoryList)),
    http.get(REPOSITORY_DOCUMENTS_PATH, endpoint(served.membership, answers.membership)),
    http.post(INSTALLATION_ALLOWLIST_PATH, endpoint(served.addInstallation, answers.add)),
    http.post(REPOSITORY_ALLOWLIST_PATH, endpoint(served.addRepository, answers.add)),
    http.delete(ALLOWLIST_ENTRY_PATH, endpoint(served.remove, answers.remove)),
  );
  return served;
}

/** The app at `route`, signed in as the test user. */
export function renderAllowlist(route: string) {
  return renderWithProviders(createElement(AppRouter), { route, session: ALICE });
}

export const ALLOWLIST_ROUTE = '/installations/5/allowlist';
/** The repository with the id 1 is `acme/widgets`, the first of the default tenant. */
export const REPOSITORY_ROUTE = '/installations/5/allowlist?repository=1';

/** The h1 of the app, once it is there. */
export const heading = (name: string | RegExp) => screen.findByRole('heading', { level: 1, name });

/** The table of entries of the scope. */
export const entriesTable = () => screen.getByRole('table', { name: messages['allowlist.caption'] });

/** The table of the entries that apply from the installation. */
export const inheritedTable = () => screen.getByRole('table', { name: messages['allowlist.inherited.caption'] });

/** The cells of the rows of `table`, as text, header row left out. */
export const rowsOf = (table: HTMLElement): string[][] =>
  within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent));

/** The "Add entry" button of the page. */
export const addButton = () => screen.getByRole('button', { name: messages['allowlist.add'] });

/** The add dialog, once it is open. */
export const addDialog = () => screen.getByRole('dialog', { name: messages['allowlist.add.title'] });

/** The GitHub login field of the add dialog (its label says it is required). */
export const loginField = () =>
  within(addDialog()).getByRole('textbox', {
    name: `${messages['allowlist.add.login']} ${messages['common.required']}`,
  });

/** The "Add to allowlist" button of the dialog. */
export const submitButton = () => within(addDialog()).getByRole('button', { name: messages['allowlist.add.submit'] });

/** A radio of the kind choice in the add dialog. */
export const kindRadio = (label: string) => within(addDialog()).getByRole('radio', { name: label });

/** The "Remove" button of the row of the account `login`. */
export const removeButton = (login: string) =>
  screen.getByRole('button', { name: messages['allowlist.remove.label'].replace('{account}', login) });

/** The question of the removal, once it is open. */
export const removeDialog = () => screen.getByRole('alertdialog');

/** The scope select of the page. */
export const scopeSelect = () => screen.getByRole('combobox', { name: messages['allowlist.scope'] });

/** Opens the allowlist at `route` and waits for the entries to be there. */
export async function openAllowlist(route: string, serve: ServeAllowlist = {}) {
  const served = serveAllowlist(serve);
  const rendered = renderAllowlist(route);
  await heading(messages['allowlist.title']);
  await screen.findByRole('heading', { level: 2, name: messages['allowlist.entries.title'] });
  return { served, ...rendered };
}
