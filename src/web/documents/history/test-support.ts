// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { http } from 'msw';
import { assert } from 'vitest';
import type { z } from 'zod';
import { VERSION_PATH, VERSIONS_PATH } from '../../../shared/cla.ts';
import { versionDetailSchema, versionSummarySchema } from '../../../shared/cla-history.ts';
import { envelope, json, type Seen } from '../../api/test-support.ts';
import { messages } from '../../i18n/index.ts';
import { server } from '../../test-support/server.ts';
import {
  type Answer,
  answerWith,
  detailOf,
  listedOf,
  nth,
  record,
  renderDocuments,
  type Serve,
  serveDocuments,
  versionOf,
} from '../test-support.ts';

// The server of the history screens, as MSW answers for it in the tests of E18-S11: the versions of one document, newest first, and
// one version with its text, every request recorded. The values are made up. The versions below are the ones of the default document
// of `../test-support.ts` once its active version is the newest of them (`openHistory` makes that so).

type DetailInput = z.input<typeof versionDetailSchema>;

/** The text of version 2.0. Made-up CLA text, not legal text. */
const TEXT_2_0 = '# Zzzz agreement\n\nTwo point oh.\n';

/** A version as `GET .../versions/:versionId` sends it: `overrides` are put over 2.0, the active version, and the contract is checked. */
export function historyVersion(overrides: Partial<DetailInput> = {}) {
  return versionDetailSchema.parse({
    id: 303,
    major: 2,
    minor: 0,
    contentSha256: 'c'.repeat(64),
    publishedAt: '2026-10-05T10:00:00.000Z',
    publishedBy: { githubId: 4711, login: 'octocat' },
    rationale: 'Clarified the patent grant',
    active: true,
    signatureCount: 7,
    contentMd: TEXT_2_0,
    ...overrides,
  });
}

/** Version 1.1: a typo fixed, of the first major, no longer the active one. */
export const V1_1 = historyVersion({
  id: 302,
  major: 1,
  minor: 1,
  contentSha256: 'b'.repeat(64),
  publishedAt: '2026-09-20T09:00:00.000Z',
  publishedBy: { githubId: 4712, login: 'hubot' },
  rationale: 'Fixed a typo',
  active: false,
  signatureCount: 12,
  contentMd: '# Zzzz agreement\n\nOne point one.\n',
});

/** Version 1.0, the first. */
export const V1_0 = historyVersion({
  id: 301,
  major: 1,
  minor: 0,
  contentSha256: 'a'.repeat(64),
  publishedAt: '2026-09-01T08:00:00.000Z',
  publishedBy: { githubId: 4711, login: 'octocat' },
  rationale: 'First version',
  active: false,
  signatureCount: 9,
  contentMd: '# Zzzz agreement\n\nOne point oh.\n',
});

/** The history of the default document: 2.0 (active), 1.1 and 1.0, newest first. */
export const HISTORY: readonly DetailInput[] = [historyVersion(), V1_1, V1_0];

/** What a test says the history server answers. */
export interface HistoryServe {
  /** The versions of the document, newest first: `HISTORY` when absent. */
  readonly versions?: readonly DetailInput[];
  /** The answers to the 1st, 2nd, ... request for the list, the last one repeating; the list of `versions` when absent. */
  readonly list?: readonly Answer[];
  /** The answer for one version id, instead of that version. */
  readonly read?: ReadonlyMap<number, Answer>;
}

/** Every request the history screens made, in order. */
export interface HistoryServed {
  readonly list: Seen[];
  /** Includes the read of the active version that the editor makes when the document opens. */
  readonly read: Seen[];
}

/** The list of `versions` as `GET .../versions` sends it: the rows without their text. */
export function pageOf(versions: readonly DetailInput[], nextCursor: string | null = null): Response {
  return json({ versions: versions.map((version) => versionSummarySchema.parse(version)), nextCursor });
}

/** A version of the document, a held `Answer`, or the uniform `404` for an id the document does not have. */
async function answerFor(id: number, serve: HistoryServe, versions: readonly DetailInput[]): Promise<Response> {
  const answer = serve.read?.get(id);
  if (answer !== undefined) {
    return await answerWith(answer);
  }
  const version = versions.find((candidate) => candidate.id === id);
  return version === undefined ? envelope(404, 'not_found') : json({ version: versionDetailSchema.parse(version) });
}

/** Serves the history endpoints of the document of `/installations/5/documents/11`: they take over from the ones of `serveDocuments`. */
export function serveHistory(serve: HistoryServe = {}): HistoryServed {
  const versions = serve.versions ?? HISTORY;
  const served: HistoryServed = { list: [], read: [] };
  server.use(
    http.get(VERSIONS_PATH, async ({ request }) => {
      served.list.push(await record(request));
      return await nth(serve.list ?? [pageOf(versions)], served.list.length);
    }),
    http.get(VERSION_PATH, async ({ request, params }) => {
      served.read.push(await record(request));
      return await answerFor(Number(params['versionId']), serve, versions);
    }),
  );
  return served;
}

const HISTORY_ROUTE = '/installations/5/documents/11?tab=history';

/** The active version of `versions`, as the detail of a document carries it: none for a document that has no version. */
function activeOf(versions: readonly DetailInput[]) {
  const active = versions.find((version) => version.active) ?? versions[0];
  return active === undefined
    ? null
    : versionOf({
        id: active.id,
        major: active.major,
        minor: active.minor,
        contentSha256: active.contentSha256,
        publishedAt: active.publishedAt,
      });
}

export interface OpenedHistory {
  readonly serve?: Serve;
  readonly history?: HistoryServe;
  readonly route?: string;
  /** What the test waits for once the app is rendered: the table of versions when absent. */
  readonly ready?: () => Promise<unknown>;
}

/** The table of versions, once it is there. */
const tableIsThere = () => screen.findByRole('table', { name: messages['history.caption'] });

/**
 * Opens a document on `route` (the History tab by default) with the document endpoints of `serve` and the history of `history`, whose
 * active version is the one the document points at, and waits for the table of versions (or for `ready`).
 */
export async function openHistory({
  serve = {},
  history = {},
  route = HISTORY_ROUTE,
  ready = tableIsThere,
}: OpenedHistory = {}) {
  const versions = history.versions ?? HISTORY;
  const documents = serveDocuments({ detail: [detailOf(listedOf({ activeVersion: activeOf(versions) }))], ...serve });
  const served = serveHistory(history);
  const rendered = renderDocuments(route);
  await ready();
  return { served, documents, ...rendered };
}

/** The table of versions. */
export const versionsTable = () => screen.getByRole('table', { name: messages['history.caption'] });

/** The row of the version `number` (`1.1`): the one whose first cell says so. */
export function rowOf(number: string): HTMLElement {
  const row = within(versionsTable())
    .getAllByRole('row')
    .find((candidate) => candidate.querySelector('td')?.textContent === number);
  assert(row, `no row for version ${number}`);
  return row;
}

/** The "View" button of the version `number`. */
export const viewButton = (number: string) =>
  screen.getByRole('button', { name: messages['history.view.label'].replace('{version}', number) });

/** The section that shows one version, once it is there. */
export const viewer = (number: string) =>
  screen.findByRole('region', { name: messages['history.viewer.title'].replace('{version}', number) });

/** The section of the comparison. */
export const comparison = () => screen.findByRole('region', { name: messages['history.compare.title'] });

/** The list of lines of a diff, by the numbers of the two versions. */
export const diffList = (from: string, to: string) =>
  screen.findByRole('list', {
    name: messages['history.diff.label'].replace('{from}', from).replace('{to}', to),
  });

/** The path and search of the address the app is on. */
export const address = () => `${window.location.pathname}${window.location.search}`;

/** The dialog that restores the text of the version `number`, once it is open. */
export const restoreDialog = (number: string) =>
  screen.findByRole('dialog', { name: messages['restore.title'].replace('{version}', number) });

/** The rationale field of a dialog (its label says it is required). */
export const rationaleOf = (dialog: HTMLElement) =>
  within(dialog).getByRole('textbox', { name: `${messages['publish.rationale']} ${messages['common.required']}` });

/** The "Publish version" button of a dialog. */
export const publishOf = (dialog: HTMLElement) =>
  within(dialog).getByRole('button', { name: messages['publish.submit'] });

/** The re-signing confirmation of a dialog. */
export const resignOf = (dialog: HTMLElement) =>
  within(dialog).getByRole('checkbox', {
    name: `${messages['publish.resign.confirm']} ${messages['common.required']}`,
  });

/** Opens the History tab, views the version `number` and presses "Restore this text": the dialog is open when this returns. */
export async function openRestore(number: string, options: OpenedHistory = {}) {
  const opened = await openHistory(options);
  await opened.user.click(viewButton(number));
  const region = await viewer(number);
  await opened.user.click(within(region).getByRole('button', { name: messages['restore.action'] }));
  const dialog = await restoreDialog(number);
  return { ...opened, region, dialog };
}

/** Types a rationale in `dialog` and presses "Publish version". */
export async function publishWith(
  opened: { readonly user: Awaited<ReturnType<typeof openHistory>>['user']; readonly dialog: HTMLElement },
  rationale = 'Went back to the earlier wording',
): Promise<void> {
  await opened.user.click(rationaleOf(opened.dialog));
  await opened.user.paste(rationale);
  await opened.user.click(publishOf(opened.dialog));
}

/** A history whose active version is 1.1, so that 1.0 is a copy within the same major. */
export const WITHIN_MAJOR: HistoryServe = { versions: [{ ...V1_1, active: true }, V1_0] };
