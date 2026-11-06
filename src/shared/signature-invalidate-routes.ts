// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { documentParamsSchema } from './cla-routes.ts';
import { defineRoute } from './contract.ts';
import {
  INVALIDATION_PREVIEW_PATH,
  INVALIDATIONS_PATH,
  invalidationPreviewResponseSchema,
  invalidationRequestSchema,
  invalidationResponseSchema,
} from './signature-invalidate.ts';

// The route descriptors of the invalidation of a major (E15-S04) that the document screen of E18-S14 calls by: the paths and the schemas
// of the body and of the answers are those of signature-invalidate.ts, so the screen and the server cannot drift apart. The query of the
// preview is written with the number the screen holds (the server reads the same value from plain digits).

/** `GET .../documents/:documentId/invalidation-preview?major=` (E15-S04): how many signatures of the major are in force, as counts only. */
export const invalidationPreviewRoute = defineRoute({
  method: 'GET',
  path: INVALIDATION_PREVIEW_PATH,
  params: documentParamsSchema,
  query: z.strictObject({ major: invalidationRequestSchema.shape.major }),
  responses: { 200: invalidationPreviewResponseSchema },
});

/** `POST .../documents/:documentId/invalidations` (E15-S04): takes every signature in force of one major out of force, held to the count the preview showed. */
export const invalidationsRoute = defineRoute({
  method: 'POST',
  path: INVALIDATIONS_PATH,
  params: documentParamsSchema,
  body: invalidationRequestSchema,
  responses: { 200: invalidationResponseSchema },
});
