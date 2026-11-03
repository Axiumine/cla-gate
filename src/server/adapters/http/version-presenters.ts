// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { MAX_REVISION } from '../../../shared/cla.ts';
import type { versionDetailSchema, versionSummarySchema } from '../../../shared/cla-history.ts';
import type { VersionNumber } from '../../domain/version-number.ts';
import type { HistoryVersion, HistoryVersionText } from '../../services/cla-history-rows.ts';
import { decodeCursor, encodeCursor } from './cursor.ts';

// The history of a document as the routes of document-history-routes.ts send it (E12-S05): the stored rows with their times as
// ISO 8601. Strings (the rationale, the login of the publisher) are sent as they are stored; escaping is each screen's job.

/** A version of the history as `versionSummarySchema` has it. */
export function presentHistoryVersion(version: HistoryVersion): z.infer<typeof versionSummarySchema> {
  return {
    id: version.id,
    major: version.major,
    minor: version.minor,
    contentSha256: version.contentSha256,
    publishedBy: { githubId: version.publishedBy.githubId, login: version.publishedBy.login },
    rationale: version.rationale,
    publishedAt: version.publishedAt.toISOString(),
    active: version.active,
    signatureCount: version.signatureCount,
  };
}

/** A version with its exact text as `versionDetailSchema` has it. */
export function presentVersionText(version: HistoryVersionText): z.infer<typeof versionDetailSchema> {
  return { ...presentHistoryVersion(version), contentMd: version.contentMd };
}

/** The cursor of a page of versions stands for the number it starts at: `[major, minor]`, each a value the integer columns hold. */
const numberSchema = z
  .tuple([z.int().min(1).max(MAX_REVISION), z.int().min(0).max(MAX_REVISION)])
  .transform(([major, minor]): VersionNumber => ({ major, minor }));

/** The opaque cursor that sends a client to the page starting at `position`. */
export function versionCursor(position: VersionNumber): string {
  return encodeCursor([position.major, position.minor]);
}

/** The number a cursor stands for. @throws AppError 400 `bad_request` when the cursor is not one this server made. */
export function readVersionCursor(cursor: string): VersionNumber {
  return decodeCursor(numberSchema, cursor);
}
