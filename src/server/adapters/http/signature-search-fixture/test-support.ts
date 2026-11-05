// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect } from 'vitest';
import { errorResponseSchema } from '../../../../shared/errors.ts';
import { SIGNATURES_PATH, signatureSearchPageSchema } from '../../../../shared/signature-search.ts';
import type { PersonName } from '../../db/tenant-fixture/test-support.ts';
import { csvWorld } from '../signature-csv-fixture/test-support.ts';

// The world of the tests of the signature search (E15-S02): the two tenants of the cross-tenant matrix with five people who are
// logged in (the world of the signature CSV, which also publishes a version for the repository document of tenant 1), and a call of
// the search as one of them.

/** The path of the search of one installation. */
const searchPathOf = (installationId: number): string =>
  SIGNATURES_PATH.replace(':installationId', String(installationId));

/**
 * The matrix world with `search(who, installationId, query)`: the search as that person (nobody: no session). `app` adds the options
 * of the app a test sets, the queue of a test that signs through the real sign path, for one.
 */
export async function searchWorld(app: Parameters<typeof csvWorld>[0] = {}) {
  const state = await csvWorld(app);
  const search = (who: PersonName | null, installationId: number, query = '') =>
    state.ask(who, { method: 'GET', url: `${searchPathOf(installationId)}${query}` });
  return { ...state, search };
}

/** The body of a `200` answer, parsed with the shared schema so that a body of another shape fails here. */
export function pageOf(response: { statusCode: number; json: () => unknown }) {
  expect(response.statusCode).toBe(200);
  return signatureSearchPageSchema.parse(response.json());
}

/** The ids of the signatures a `200` answer lists, in the order of the page. */
export const idsOf = (response: { statusCode: number; json: () => unknown }): number[] =>
  pageOf(response).items.map((item) => item.id);

/** The `error.code` of an error answer. */
export const errorCodeOf = (response: { json: () => unknown }): string =>
  errorResponseSchema.parse(response.json()).error.code;

/** The body of an error answer without its request id, which is the one thing that differs between two denials. */
export const withoutRequestId = (response: { body: string }): string =>
  response.body.replace(/"requestId":"[^"]*"/u, '');
