// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';

// What the address of a document holds (E18-S05): `/installations/$installationId/documents/$documentId`, `cla_documents.id`.

/** Decimal digits with no sign, no leading zero, no exponent and no space: the only spelling of a document id the app writes. */
const PLAIN_NUMBER = /^[1-9]\d{0,15}$/;

const documentId = z.int().positive();

/**
 * The document id in the path, or `undefined` when the text is not one. The shape is the one the API accepts (a positive safe
 * integer in plain digits); `1e3`, `0x10`, ` 5` and `5.0` are not document ids and a path with one is no page of the app.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export function parseDocumentId(raw: string): number | undefined {
  if (!PLAIN_NUMBER.test(raw)) {
    return undefined;
  }
  const parsed = documentId.safeParse(Number(raw));
  return parsed.success ? parsed.data : undefined;
}

/** The `params` option of the route of a document: a segment that is not a plain positive number is no page of the app. */
export const documentRouteParams = {
  parse: ({ documentId: raw }: { readonly documentId: string }) => {
    const parsed = parseDocumentId(raw);
    return parsed === undefined ? false : { documentId: parsed };
  },
  stringify: ({ documentId: id }: { readonly documentId: number }) => ({ documentId: String(id) }),
} as const;
