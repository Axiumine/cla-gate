// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { http } from 'msw';
import { INVALIDATION_PREVIEW_PATH, INVALIDATIONS_PATH } from '../../../shared/signature-invalidate.ts';
import { envelope, json, type Seen } from '../../api/test-support.ts';
import { messages } from '../../i18n/index.ts';
import { server } from '../../test-support/server.ts';
import { type OpenedHistory, openHistory } from '../history/test-support.ts';
import { type Answer, endpoint } from '../test-support.ts';

// The server of the invalidation question, as MSW answers for it in the tests of E18-S14: the preview and the invalidation of a major, every
// request recorded. The values are made up. They sit on top of the history screens' own server (`../history/test-support.ts`), whose
// default document is `Individual CLA` (id 11) of the installation 5, with the versions 2.0 (active), 1.1 and 1.0.

/** The answer of the preview: how many signatures of `major` are in force and how many repositories are checked again. */
export function previewOf(activeSignatures = 7, affectedRepositories = 2, major = 1): Response {
  return json({ major, activeSignatures, affectedRepositories });
}

/** The `200` of an invalidation. */
export const invalidatedAs = (invalidated = 7): Response => json({ invalidated });

/** The answer of the server to a rule of the invalidation: `409 count_changed`, `409 nothing_to_invalidate`. */
export const ruleAnswer = (code: 'count_changed' | 'nothing_to_invalidate'): Response => envelope(409, code);

/** What a test says the server answers; each list is the answers to the 1st, 2nd, ... request, and the last one repeats. */
export interface ServeInvalidate {
  readonly preview?: readonly Answer[];
  readonly invalidate?: readonly Answer[];
}

/** Every request the question made to the server, in order, by endpoint. */
export interface ServedInvalidate {
  readonly preview: Seen[];
  readonly invalidate: Seen[];
}

/** Serves the preview and the invalidation with the answers `serve` gives, or a preview of 7 signatures and an invalidation of 7. */
export function serveInvalidate(serve: ServeInvalidate = {}): ServedInvalidate {
  const served: ServedInvalidate = { preview: [], invalidate: [] };
  server.use(
    http.get(INVALIDATION_PREVIEW_PATH, endpoint(served.preview, serve.preview ?? [previewOf()])),
    http.post(INVALIDATIONS_PATH, endpoint(served.invalidate, serve.invalidate ?? [invalidatedAs()])),
  );
  return served;
}

/** Waits for the counts of the preview to be in the question that is open. */
export const countsShown = async () =>
  await within(await screen.findByRole('alertdialog')).findByText(messages['invalidate.preview.activeSignatures']);

/** The "Invalidate signatures" button of the first version of `major`. */
export const invalidateButton = (major: number) =>
  screen.getByRole('button', { name: messages['invalidate.action.label'].replace('{major}', String(major)) });

/** The question, once it is open. */
export const question = () => screen.getByRole('alertdialog');

/** The reason select of the question. */
export const reasonSelect = () => within(question()).getByRole('combobox', { name: /^Reason/ });

/** The acknowledgement of the count, a checkbox whose label says how many. */
export const acknowledgement = () => within(question()).getByRole('checkbox', { name: /^I have seen that/ });

/** The confirm button of the question. */
export const confirmButton = () => within(question()).getByRole('button', { name: messages['invalidate.confirm'] });

/** The Cancel button of the question. */
export const cancelButton = () => within(question()).getByRole('button', { name: messages['common.cancel'] });

export interface OpenedQuestion extends OpenedHistory {
  /** The major whose first version has the button that opens the question: 1 when absent. */
  readonly major?: number;
  readonly invalidate?: ServeInvalidate;
  /** Wait for the counts to be in the question (the default); `false` for a preview that fails or is held, where the test waits for what it expects. */
  readonly countsReady?: boolean;
}

/** Opens the history, presses "Invalidate signatures" on the first version of `major` and waits for the counts to be in the question. */
export async function openQuestion({
  major = 1,
  invalidate = {},
  countsReady = true,
  ...options
}: OpenedQuestion = {}) {
  const served = serveInvalidate(invalidate);
  const opened = await openHistory(options);
  await opened.user.click(invalidateButton(major));
  if (countsReady) {
    await countsShown();
  } else {
    await screen.findByRole('alertdialog');
  }
  return { ...opened, invalidated: served };
}

/** Chooses a reason and acknowledges the count in the question that is open. */
export async function agree(
  user: Awaited<ReturnType<typeof openHistory>>['user'],
  reason = 'legal_request',
): Promise<void> {
  await user.selectOptions(reasonSelect(), reason);
  await user.click(acknowledgement());
}
