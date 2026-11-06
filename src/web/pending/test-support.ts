// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { http } from 'msw';
import { createElement } from 'react';
import { assert, expect } from 'vitest';
import type { z } from 'zod';
import { REPOSITORY_DOCUMENTS_PATH } from '../../shared/cla.ts';
import { COMMIT_OVERRIDE_PATH, COMMIT_OVERRIDES_PATH, commitOverridePageSchema } from '../../shared/commit-override.ts';
import { PENDING_PRS_PATH, pendingPrsPageSchema } from '../../shared/pending-prs.ts';
import { envelope, json, type Seen } from '../api/test-support.ts';
import { type Answer, endpoint, noContent, type PageAnswers, pagesEndpoint } from '../documents/test-support.ts';
import { messages } from '../i18n/index.ts';
import { serveTenants, summary, type Tenant, tenantOf } from '../installations/test-support.ts';
import { documentsOf } from '../repositories/test-support.ts';
import { AppRouter } from '../router.tsx';
import { renderWithProviders } from '../test-support/render.tsx';
import { server } from '../test-support/server.ts';
import { ALICE } from '../test-support/session.ts';

// The server of the pending screen, as MSW answers for it in the tests of E18-S08: the pending list, the overrides of a repository, the
// record and the removal of an override, and the repositories of the tenant, every request recorded. The values are made up.

const pendingItem = pendingPrsPageSchema.shape.items.element;
const overrideItem = commitOverridePageSchema.shape.items.element;

type PendingInput = z.input<typeof pendingItem>;
type OverrideInput = z.input<typeof overrideItem>;
type ReasonInput = PendingInput['reasons'][number];

/** The first of a list that is not empty: an empty one fails the test, and the type is the element's, not the element's or `undefined`. */
export function firstOf<T>(list: readonly T[]): T {
  const [head] = list;
  assert(head !== undefined, 'the list is empty');
  return head;
}

/** The head commit and the commit with the unlinked identity of the made-up pull requests. */
export const HEAD_SHA = '0123456789abcdef0123456789abcdef01234567';
export const UNLINKED_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

/** A reason as the list sends it. */
export const unsigned = (githubId: number, login: string | null): ReasonInput => ({
  code: 'unsigned_contributor',
  githubId,
  login,
});
export const unlinked = (commitSha: string = UNLINKED_SHA): ReasonInput => ({ code: 'unlinked_identity', commitSha });
export const noActiveCla: ReasonInput = { code: 'no_active_cla' };

/**
 * A pending pull request as the list sends it: number 45 of `acme/widgets` (repository 1), whose contributor `octocat` (id 4711) has not signed
 * and whose commit has an identity GitHub cannot link; `overrides` are put over it and the contract is checked.
 */
export function pendingOf(overrides: Partial<PendingInput> = {}) {
  return pendingItem.parse({
    evaluationId: 700,
    repository: { id: 1, fullName: 'acme/widgets' },
    prNumber: 45,
    headSha: HEAD_SHA,
    evaluatedAt: '2026-11-04T10:15:00.000Z',
    checkRunId: 9001,
    reasons: [unsigned(4711, 'octocat'), unlinked()],
    ...overrides,
  });
}

/** A pull request of `acme/gadgets` (repository 2) with a different problem: the repository has no active CLA version. */
export const gadgetsOf = (overrides: Partial<PendingInput> = {}) =>
  pendingOf({
    evaluationId: 701,
    repository: { id: 2, fullName: 'acme/gadgets' },
    prNumber: 7,
    headSha: 'fedcba9876543210fedcba9876543210fedcba98',
    evaluatedAt: '2026-11-03T08:00:00.000Z',
    reasons: [noActiveCla],
    ...overrides,
  });

/** A page of the pending list as a response; `nextCursor` is `null` on the last page. */
export const pageOf = (
  items: readonly ReturnType<typeof pendingOf>[],
  nextCursor: string | null = null,
  truncated = false,
): Response => json(pendingPrsPageSchema.parse({ items, nextCursor, truncated }));

/** An override as the list sends it: recorded by `octocat` (id 4711) on 2026-11-02 for the commit `UNLINKED_SHA`. */
export function overrideOf(overrides: Partial<OverrideInput> = {}) {
  return overrideItem.parse({
    id: 300,
    commitSha: UNLINKED_SHA,
    reason: 'Maintainer commit with a work email',
    createdBy: { githubId: 4711, login: 'octocat' },
    createdAt: '2026-11-02T09:30:00.000Z',
    ...overrides,
  });
}

/** A page of the overrides as a response. */
export const overridesPage = (
  items: readonly ReturnType<typeof overrideOf>[],
  nextCursor: string | null = null,
): Response => json(commitOverridePageSchema.parse({ items, nextCursor }));

/** The `201` of a record. */
export const recordedAs = (id = 301, commitSha: string = UNLINKED_SHA): Response =>
  json(
    {
      override: {
        id,
        repositoryId: 1,
        commitSha,
        reason: 'Maintainer commit',
        createdBy: { githubId: 4711, login: 'octocat' },
        createdAt: '2026-11-04T10:30:00.000Z',
      },
    },
    201,
  );

/** What the server answers when it has nothing under the id: the uniform `404` of every tenant route. */
export const notFound = (): Response => envelope(404, 'not_found');

/** A rule of the API: the status and code of its error body. */
export const rule = (status: number, code: string): Response => envelope(status, code);

export { noContent };

/** What a test says the server answers; each list is the answers to the 1st, 2nd, ... request, and the last one repeats. */
export interface ServePending {
  readonly tenants?: readonly Tenant[];
  /** What `GET /api/installations` answers when it is not the summaries of `tenants`. */
  readonly listing?: () => Response | Promise<Response>;
  readonly pending?: readonly Answer[];
  /** The pages of the pending list by cursor, `null` standing for the first page; a cursor with no page is a `400`. Used instead of `pending`. */
  readonly pages?: PageAnswers;
  readonly overrides?: readonly Answer[];
  /** The answers to the check that a repository belongs to the installation in the address (`GET .../repositories/:repositoryId/documents`). */
  readonly membership?: readonly Answer[];
  readonly record?: readonly Answer[];
  readonly remove?: readonly Answer[];
}

/** Every request the screen made to the server, in order, by endpoint. */
export interface ServedPending {
  readonly pending: Seen[];
  readonly overrides: Seen[];
  /** The checks that a repository belongs to the installation in the address. */
  readonly membership: Seen[];
  readonly record: Seen[];
  readonly remove: Seen[];
  /** The requests of the installation screens: the list of installations and the repositories. */
  readonly tenants: ReturnType<typeof serveTenants>;
}

/** The default answers: the two pull requests on one page, one override, a record of 301 and a removal. */
function defaults() {
  return {
    pending: [pageOf([pendingOf(), gadgetsOf()])],
    overrides: [overridesPage([overrideOf()])],
    membership: [documentsOf()],
    record: [recordedAs()],
    remove: [noContent()],
  };
}

/**
 * Serves the pending endpoints (and the installation screens' own, for the role, the suspended flag and the repositories: `acme/widgets`
 * is repository 1 and `acme/gadgets` repository 2 of installation 5) with the answers `serve` gives, or the defaults.
 */
export function servePending(serve: ServePending = {}): ServedPending {
  const answers = { ...defaults(), ...serve };
  const served: ServedPending = {
    pending: [],
    overrides: [],
    membership: [],
    record: [],
    remove: [],
    tenants: serveTenants(serve.tenants ?? [tenantOf(summary(), 'acme/widgets', 'acme/gadgets')], serve.listing),
  };
  server.use(
    http.get(
      PENDING_PRS_PATH,
      serve.pages === undefined
        ? endpoint(served.pending, answers.pending)
        : pagesEndpoint(served.pending, serve.pages),
    ),
    http.get(COMMIT_OVERRIDES_PATH, endpoint(served.overrides, answers.overrides)),
    http.get(REPOSITORY_DOCUMENTS_PATH, endpoint(served.membership, answers.membership)),
    http.post(COMMIT_OVERRIDES_PATH, endpoint(served.record, answers.record)),
    http.delete(COMMIT_OVERRIDE_PATH, endpoint(served.remove, answers.remove)),
  );
  return served;
}

/** The app at `route`, signed in as the test user. */
export function renderPending(route: string) {
  return renderWithProviders(createElement(AppRouter), { route, session: ALICE });
}

export const PENDING_ROUTE = '/installations/5/pending';
export const OVERRIDES_ROUTE = `${PENDING_ROUTE}?tab=overrides`;

/** The h1 of the app, once it is there. */
export const heading = (name: string | RegExp) => screen.findByRole('heading', { level: 1, name });

/** The table of pending pull requests. */
export const pendingTable = () => screen.getByRole('table', { name: messages['pending.caption'] });

/** The table of overrides. */
export const overridesTable = () => screen.getByRole('table', { name: messages['pending.overrides.caption'] });

/** The cells of the rows of `table`, as text, header row left out. */
export const rowsOf = (table: HTMLElement): string[][] =>
  within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent));

// What a test reads back from a recorded request: the same readers as the other screens.
export { bodyOf, paramsOf, pathOf } from '../documents/test-support.ts';

/** The repository filter of the pending tab, and its reason filter. */
export const repositoryFilter = () => screen.getByRole('combobox', { name: messages['pending.filter.repository'] });
export const reasonFilter = () => screen.getByRole('combobox', { name: messages['pending.filter.reason'] });

/** The "Record override" button of the commit whose short id is `commit` in `repository`. */
export const recordButton = (commit: string, repository = 'acme/widgets') =>
  screen.getByRole('button', {
    name: messages['pending.override.label'].replace('{commit}', commit).replace('{repository}', repository),
  });

/** The record dialog, once it is open. */
export const recordDialog = () => screen.getByRole('dialog', { name: messages['pending.override.title'] });

/** Cancels the record dialog, waits until it has closed, and opens it again on the commit whose short id is `commit`. */
export async function cancelAndReopen(user: UserEvent, commit: string): Promise<void> {
  await user.click(within(recordDialog()).getByRole('button', { name: messages['common.cancel'] }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  await user.click(recordButton(commit));
  await screen.findByRole('dialog');
}

/** The reason field and the submit button of the record dialog. */
export const reasonField = () => within(recordDialog()).getByRole('textbox', { name: /^Reason/ });
export const submitButton = () =>
  within(recordDialog()).getByRole('button', { name: messages['pending.override.submit'] });

/** The "Remove" button of the override of the commit whose short id is `commit`. */
export const removeButton = (commit: string) =>
  screen.getByRole('button', { name: messages['pending.overrides.remove.label'].replace('{commit}', commit) });

/** The question of the removal, once it is open. */
export const removeDialog = () => screen.getByRole('alertdialog');

/** The confirm button of the removal question. */
export const confirmRemoval = () =>
  within(removeDialog()).getByRole('button', { name: messages['pending.overrides.remove.confirm'] });

/** Opens the pending tab at `route` and waits for the rows to be there. */
export async function openPending(route: string = PENDING_ROUTE, serve: ServePending = {}) {
  const served = servePending(serve);
  const rendered = renderPending(route);
  await heading(messages['pending.title']);
  await screen.findByRole('table', { name: messages['pending.caption'] });
  return { served, ...rendered };
}

/** Opens the overrides tab at `route`, the repository chosen in the address, and waits for the rows to be there. */
export async function openOverrides(route = `${OVERRIDES_ROUTE}&repository=1`, serve: ServePending = {}) {
  const served = servePending(serve);
  const rendered = renderPending(route);
  await heading(messages['pending.title']);
  await screen.findByRole('table', { name: messages['pending.overrides.caption'] });
  return { served, ...rendered };
}
