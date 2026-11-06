// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { defineRoute } from './contract.ts';
import {
  ERASURE_PREVIEW_PATH,
  ERASURES_PATH,
  erasurePreviewSchema,
  erasureRequestSchema,
  erasureResultSchema,
} from './erasure.ts';
import { installationParamsSchema } from './installations.ts';

// The route descriptors of the erasure of a signer's personal data (E16-S04) that the signatures screen of E18-S14 calls by: the paths
// and the schemas of the body and of the answers are those of erasure.ts, so the screen and the server cannot drift apart. The query of
// the preview is written with the number the screen holds (the server reads the same value from plain digits).

/** `GET .../installations/:installationId/erasure-preview?githubUserId=` (E16-S04): what an erasure would remove, as counts only. */
export const erasurePreviewRoute = defineRoute({
  method: 'GET',
  path: ERASURE_PREVIEW_PATH,
  params: installationParamsSchema,
  query: z.strictObject({ githubUserId: erasureRequestSchema.shape.githubUserId }),
  responses: { 200: erasurePreviewSchema },
});

/** `POST .../installations/:installationId/erasures` (E16-S04): erases the personal data the installation holds for one person. */
export const erasuresRoute = defineRoute({
  method: 'POST',
  path: ERASURES_PATH,
  params: installationParamsSchema,
  body: erasureRequestSchema,
  responses: { 200: erasureResultSchema },
});
