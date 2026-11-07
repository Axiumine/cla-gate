// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { http } from 'msw';
import {
  ERASURE_PREVIEW_PATH,
  ERASURES_PATH,
  erasurePreviewSchema,
  erasureResultSchema,
} from '../../../shared/erasure.ts';
import { envelope, json, type Seen } from '../../api/test-support.ts';
import { type Answer, endpoint } from '../../documents/test-support.ts';
import { messages } from '../../i18n/index.ts';
import { server } from '../../test-support/server.ts';
import { openSignatures, type ServeSignatures, SIGNATURES_ROUTE } from '../test-support.ts';

// The server of the erasure question, as MSW answers for it in the tests of E18-S14: the preview and the erasure of one person's personal
// data, every request recorded. The values are made up. They sit on top of the signatures screen's own server (`../test-support.ts`),
// whose default page holds Ada Lovelace (GitHub id 4711, signature 900) and Grace Hopper (583231, signature 901) of the installation 5.

/**
 * The answer of the preview: the person has `signatures` signatures, `signerPiiRows` rows of personal data, `allowlistEntries` allowlist
 * entries and `corporateApprovals` approvals of a corporate agreement (E21) that name them.
 */
export function previewOf(
  signatures = 2,
  signerPiiRows = 2,
  allowlistEntries = 0,
  { githubUserId = 4711, corporateApprovals = 0 }: { githubUserId?: number; corporateApprovals?: number } = {},
): Response {
  return json(
    erasurePreviewSchema.parse({ githubUserId, signatures, signerPiiRows, allowlistEntries, corporateApprovals }),
  );
}

/** The `200` of an erasure. */
export const erasedAs = (erasedRows = 2): Response => json(erasureResultSchema.parse({ erasedRows }));

/** The answer of the server to the person it holds nothing of, or to an installation the viewer may not open. */
export const nothingHeld = (): Response => envelope(404, 'not_found');

/** The answer of the server to an erasure whose count moved. */
export const countChanged = (): Response => envelope(409, 'count_changed');

/** What a test says the server answers; each list is the answers to the 1st, 2nd, ... request, and the last one repeats. */
export interface ServeErase {
  readonly preview?: readonly Answer[];
  readonly erase?: readonly Answer[];
}

/** Every request the question made to the server, in order, by endpoint. */
export interface ServedErase {
  readonly preview: Seen[];
  readonly erase: Seen[];
}

/** Serves the preview and the erasure with the answers `serve` gives, or a preview of two signatures and two rows and an erasure of two. */
export function serveErase(serve: ServeErase = {}): ServedErase {
  const served: ServedErase = { preview: [], erase: [] };
  server.use(
    http.get(ERASURE_PREVIEW_PATH, endpoint(served.preview, serve.preview ?? [previewOf()])),
    http.post(ERASURES_PATH, endpoint(served.erase, serve.erase ?? [erasedAs()])),
  );
  return served;
}

/** The "Erase personal data" button of the row of the signer called `name`. */
export const eraseButton = (name: string) =>
  screen.getByRole('button', { name: messages['erase.action.label'].replace('{signer}', name) });

/** The button of a row whose personal data is erased: it reads "Erased" and is unavailable. */
export const erasedButton = (name: string) =>
  screen.getByRole('button', { name: messages['erase.erased.label'].replace('{signer}', name) });

/** The question, once it is open. */
export const question = () => screen.getByRole('alertdialog');

/** The confirm button of the question. */
export const confirmButton = () => within(question()).getByRole('button', { name: messages['erase.confirm'] });

/** The Cancel button of the question. */
export const cancelButton = () => within(question()).getByRole('button', { name: messages['common.cancel'] });

/** Waits for the counts of the preview to be in the question that is open. */
export const countsShown = async () =>
  await within(await screen.findByRole('alertdialog')).findByRole('heading', { name: messages['erase.removes'] });

export interface OpenedErase {
  /** The signer whose row has the button: Ada Lovelace when absent. */
  readonly name?: string;
  readonly erase?: ServeErase;
  readonly signatures?: ServeSignatures;
  readonly route?: string;
  /** Wait for the counts to be in the question (the default); `false` for a preview that fails or is held, where the test waits for what it expects. */
  readonly ready?: boolean;
}

/** Opens the signatures, presses "Erase personal data" on the row of `name` and waits for the counts to be in the question. */
export async function openErase({
  name = 'Ada Lovelace',
  erase = {},
  signatures = {},
  route = SIGNATURES_ROUTE,
  ready = true,
}: OpenedErase = {}) {
  const erased = serveErase(erase);
  const opened = await openSignatures(route, signatures);
  await opened.user.click(eraseButton(name));
  if (ready) {
    await countsShown();
  } else {
    await screen.findByRole('alertdialog');
  }
  return { ...opened, erased };
}
