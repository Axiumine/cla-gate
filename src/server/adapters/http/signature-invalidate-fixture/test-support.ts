// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import {
  INVALIDATION_PREVIEW_PATH,
  INVALIDATIONS_PATH,
  invalidationPreviewResponseSchema,
  invalidationResponseSchema,
} from '../../../../shared/signature-invalidate.ts';
import type { PersonName } from '../../db/tenant-fixture/test-support.ts';
import type { DocumentWorld } from '../document-fixture/test-support.ts';
import { parsed } from '../document-fixture/test-support.ts';

// The helpers of the tests of the preview and the making of an invalidation of a major (E15-S04), on the world of the revocation tests
// (`revokeWorld`, with `enforceDocuments`): two tenants, five people, the real app on PGlite and a fake queue. The signatures are
// stored past the routes with `addSignatures` of services/invalidation-fixture.

/** The body of an invalidation of major 1 that most tests send, holding it to `expectedCount`. */
export const bodyFor = (expectedCount: number, major = 1, reasonCode = 'maintainer_decision') => ({
  major,
  reasonCode,
  expectedCount,
});

/** The document of an installation, as the paths name them. */
interface DocumentRef {
  readonly installationId: number | string;
  readonly documentId: number | string;
}

const pathOf = (template: string, target: DocumentRef): string =>
  template.replace(':installationId', String(target.installationId)).replace(':documentId', String(target.documentId));

/** The path of the preview of the document, with `query` as its query string (`major=1` unless given). */
const previewPath = (target: DocumentRef, query = 'major=1'): string =>
  `${pathOf(INVALIDATION_PREVIEW_PATH, target)}?${query}`;

/** The path that invalidates a major of the document. */
export const invalidationsPath = (target: DocumentRef): string => pathOf(INVALIDATIONS_PATH, target);

/** Asks for the preview as `who`; `query` is the query string. */
export function previewAs(world: DocumentWorld, who: PersonName | null, target: DocumentRef, query?: string) {
  return world.ask(who, { method: 'GET', url: previewPath(target, query) });
}

/** Invalidates a major as `who` with `body` as the body. */
export function invalidateWith(world: DocumentWorld, who: PersonName | null, target: DocumentRef, body: object) {
  return world.ask(who, { method: 'POST', url: invalidationsPath(target), payload: body });
}

/** Invalidates major 1 as `who`, holding the invalidation to `expectedCount`. */
export function invalidateAs(world: DocumentWorld, who: PersonName | null, target: DocumentRef, expectedCount: number) {
  return invalidateWith(world, who, target, bodyFor(expectedCount));
}

/** The answer of a preview that succeeded, read with the shared schema. */
export const previewAnswerOf = (response: { json: () => unknown }) =>
  parsed(response, invalidationPreviewResponseSchema);

/** The answer of an invalidation that succeeded, read with the shared schema. */
export const invalidatedAnswerOf = (response: { json: () => unknown }) => parsed(response, invalidationResponseSchema);
