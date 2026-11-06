// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { z } from 'zod';
import type { PublishSource, publishVersionRequestSchema, VersionBump } from '../../shared/cla-version.ts';

// The request of a publish (E18-S05), made in one place so that what the screen sends is what the story says it sends.

/** The body of `POST .../versions` as the schema of the contract takes it. */
export type PublishBody = z.input<typeof publishVersionRequestSchema>;

export interface PublishInput {
  /** Where the text comes from: the saved draft at a revision, or a version of the document. */
  readonly source: PublishSource;
  readonly bump: VersionBump;
  /** The rationale as the server will store it (`normaliseRationale`). */
  readonly rationale: string;
  /** `cla_versions.id` of the version the person saw as the active one, or `null` when the document has none. */
  readonly activeVersionId: number | null;
  /** The person confirmed that the signers of the current major must sign again: only a retry after `409 resign_confirmation_required` says so. */
  readonly acknowledgeResigning: boolean;
}

/**
 * `{ source, bump, rationale, expectedActiveVersionId }` with the source `{ type: 'draft', revision }` or `{ type: 'version', versionId }`, and `acknowledgeResigning: true` only when the
 * person confirmed the re-signing: the first request of a major publish never carries it, so the server can ask.
 */
export function publishBody(input: PublishInput): PublishBody {
  return {
    source: input.source,
    bump: input.bump,
    rationale: input.rationale,
    expectedActiveVersionId: input.activeVersionId,
    ...(input.acknowledgeResigning ? { acknowledgeResigning: true } : {}),
  };
}
