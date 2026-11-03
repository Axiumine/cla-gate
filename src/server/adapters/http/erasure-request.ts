// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { erasureRequestSchema } from '../../../shared/erasure.ts';
import { githubIdSchema } from '../../../shared/github-id.ts';
import { ErasureCountChangedError, SignerNotFoundError } from '../../services/signer-erasure-errors.ts';
import { AppError } from './errors.ts';
import { idText } from './query-values.ts';

/** The query string of the erasure preview (E16-S04): the person, by numeric GitHub id. A parameter it does not know is a `400`. */
export const previewQuerySchema = z.strictObject({ githubUserId: idText.pipe(githubIdSchema) });

/** The body of the erasure as the schema reads it. @throws AppError 400 when it is not `{ githubUserId, expectedRows }` and nothing more. */
export function erasureRequest(body: unknown): z.infer<typeof erasureRequestSchema> {
  const parsed = erasureRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(400, 'bad_request');
  }
  return parsed.data;
}

/** The failures of the service as the API answers them: no signature of the person here is the `404`, a changed count the `409`. */
export function asAppError(error: unknown): unknown {
  if (error instanceof SignerNotFoundError) {
    return new AppError(404, 'not_found');
  }
  return error instanceof ErasureCountChangedError ? new AppError(409, 'count_changed') : error;
}
