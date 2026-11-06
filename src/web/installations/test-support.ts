// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { createElement } from 'react';
import type { z } from 'zod';
import {
  INSTALLATION_REPOSITORIES_PATH,
  INSTALLATIONS_PATH,
  type InstallationSummary,
  installationSummarySchema,
  type RepositoryPage,
  repositoryItemSchema,
  repositoryPageSchema,
} from '../../shared/installations.ts';
import { envelope, json, type Seen } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { AppRouter } from '../router.tsx';
import { renderWithProviders } from '../test-support/render.tsx';
import { server } from '../test-support/server.ts';
import { ALICE } from '../test-support/session.ts';

// The server of the installation screens, as MSW answers for it in the tests of E18-S04: the list of installations of the
// person and the repositories of each tenant, every request recorded. All values are made up.

type SummaryInput = z.input<typeof installationSummarySchema>;
type RepositoryInput = z.input<typeof repositoryItemSchema>;

/** An organisation the person administers, with twelve repositories of which three enforce the CLA. */
const ACME: SummaryInput = {
  id: 5,
  accountLogin: 'acme',
  accountType: 'Organization',
  role: 'org_admin',
  suspended: false,
  repositoryCount: 12,
  enabledCount: 3,
  truncated: false,
};

/** An installation as the list sends it: `overrides` are put over the organisation `acme` and the contract is checked. */
export function summary(overrides: Partial<SummaryInput> = {}): InstallationSummary {
  return installationSummarySchema.parse({ ...ACME, ...overrides });
}

/** A second tenant, so that two are never confused: the organisation `globex`, where the person is a repo admin. */
export function globex(overrides: Partial<SummaryInput> = {}): InstallationSummary {
  return summary({
    id: 6,
    accountLogin: 'globex',
    role: 'repo_admin',
    repositoryCount: 2,
    enabledCount: 0,
    ...overrides,
  });
}

/** A repository as the list sends it: enforcing the CLA unless `overrides` say otherwise. */
export function repository(id: number, fullName: string, overrides: Partial<RepositoryInput> = {}) {
  return repositoryItemSchema.parse({
    id,
    githubRepoId: 9000 + id,
    fullName,
    enabled: true,
    canAdminister: true,
    document: null,
    ...overrides,
  });
}

/** A page of repositories as a response; `nextCursor` is `null` on the last page. */
export function repositoriesOf(items: RepositoryPage['items'], nextCursor: string | null = null): Response {
  return json(repositoryPageSchema.parse({ items, nextCursor }));
}

/** What the server answers for the repositories of one tenant. */
type Answer = () => Response | Promise<Response>;

/** A tenant of the made-up server: its row in the list, and what its repositories endpoint answers. */
export interface Tenant {
  readonly summary: InstallationSummary;
  readonly answer: Answer;
}

/** The uniform `404` that every tenant route answers for an unknown id, a missing role or a tenant the instance does not admit. */
const notFound = (): Response => envelope(404, 'not_found');

/** Every request the screens made to the server, in order. */
export interface Served {
  readonly list: Seen[];
  readonly repositories: Seen[];
}

function record(request: Request): Seen {
  return { method: request.method, url: request.url, headers: Object.fromEntries(request.headers), text: '' };
}

/**
 * Serves the list of installations (the summaries of `tenants`, or `listing` when the test gives another answer) and the
 * repositories of each tenant. A tenant that is not in `tenants` is the uniform `404`, like the real server.
 */
export function serveTenants(tenants: readonly Tenant[], listing?: Answer): Served {
  const served: Served = { list: [], repositories: [] };
  const answers = new Map(tenants.map((tenant) => [tenant.summary.id, tenant.answer]));
  server.use(
    http.get(INSTALLATIONS_PATH, async ({ request }) => {
      served.list.push(record(request));
      return listing === undefined ? json(tenants.map((tenant) => tenant.summary)) : await listing();
    }),
    http.get(INSTALLATION_REPOSITORIES_PATH, async ({ request, params }) => {
      served.repositories.push(record(request));
      const answer = answers.get(Number(params['installationId']));
      return answer === undefined ? notFound() : await answer();
    }),
  );
  return served;
}

/** A tenant whose repositories are the given names, all enforcing. */
export function tenantOf(row: InstallationSummary, ...names: string[]): Tenant {
  return { summary: row, answer: () => repositoriesOf(names.map((name, index) => repository(index + 1, name))) };
}

/** The error answer of a failing list: GitHub down (`502`), or limiting the installation (`503` with its wait). */
export const githubDown = (): Response => envelope(502, 'github_unavailable');
export const githubLimited = (seconds: number): Response =>
  envelope(503, 'github_rate_limited', { 'retry-after': String(seconds) });

/** What `GET /api/meta` says when the App can be installed from GitHub. */
export const META_WITH_APP = {
  sourceUrl: 'https://github.com/Axiumine/cla-gate',
  commit: null,
  installUrl: 'https://github.com/apps/cla-gate/installations/new',
} as const;

/** The app at `route`, signed in as the test user. */
export function renderInstallations(route: string, meta?: typeof META_WITH_APP) {
  return renderWithProviders(createElement(AppRouter), {
    route,
    session: ALICE,
    ...(meta === undefined ? {} : { meta }),
  });
}

/** The h1 of the app, once it is there. */
export const heading = (name: string | RegExp) => screen.findByRole('heading', { level: 1, name });

/** The table of installations. */
export const installationsTable = () => screen.getByRole('table', { name: messages['installations.caption'] });

/** The table of repositories of a tenant. */
export const repositoriesTable = () =>
  screen.getByRole('table', { name: messages['installation.repositories.caption'] });

/** The row of the table on screen whose text starts with `start`: the account of an installation, the name of a repository. */
export const rowStartingWith = (start: string): HTMLElement =>
  screen.getByRole('row', { name: (name) => name.startsWith(start) });

/** The empty answer for the list of a person who administers nothing. */
export const noInstallations = (): Response => HttpResponse.json([]);
