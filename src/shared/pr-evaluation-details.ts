// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { FAILURE_CODES, LISTING_STATES, OUTCOMES } from './pr-evaluation-codes.ts';
import { actorSchema, advisorySchema, countSchema, idSchema, unlinkedSchema } from './pr-evaluation-parts.ts';

// E08-S01: the schema of `pr_evaluations.details`, with the closed lists it validates in pr-evaluation-codes.ts and its parts in pr-evaluation-parts.ts. It lives
// in src/shared because the pure engine (src/server/domain/evaluation) writes the value and the dashboard and the reports
// read it, and neither side may import the other. The value holds numeric ids and codes only: no name, login or email.
// Every string in it is an enum member or a lower-case commit SHA, so personal data has no field to hide in.

/** Version of the stored shape. Bump it, and keep reading the old one, when a field changes meaning. */
const DETAILS_VERSION = 1;

/**
 * The most entries a stored value keeps in each list. A pull request has at most 2,000 commits, but each can bring two
 * identities and twenty trailers, so the lists are bounded here, in the schema, rather than by a size we hope for: the
 * largest value that passes this schema is under 256 KiB (a test builds it). The engine keeps the entries that explain
 * a failure first (the uncovered actors, the findings without an override) and counts the rest in `omitted`.
 */
export const STORED_LIMITS = { actors: 500, unlinked: 500, advisories: 500 } as const;

/** How many entries of each list were left out of the stored value to keep it small. Absent when nothing was. */
const omittedSchema = z.strictObject({ actors: countSchema, unlinked: countSchema, advisories: countSchema });

/** Both or neither: a repository without an active CLA has no document and no major. */
const hasPolicyOrNeither = (details: { documentId: number | null; activeMajor: number | null }): boolean =>
  (details.documentId === null) === (details.activeMajor === null);

/** `success` exactly when nothing failed (E08-S08). */
const outcomeMatchesCodes = (details: { outcome: string; failureCodes: readonly string[] }): boolean =>
  (details.outcome === 'success') === (details.failureCodes.length === 0);

/** The schema of `pr_evaluations.details` (strict, `version: 1`). */
export const PrEvaluationDetails = z
  .strictObject({
    version: z.literal(DETAILS_VERSION),
    outcome: z.enum(OUTCOMES),
    failureCodes: z.array(z.enum(FAILURE_CODES)).max(FAILURE_CODES.length),
    documentId: idSchema.nullable(),
    activeMajor: idSchema.nullable(),
    commitCount: countSchema,
    mergeCommitsSkipped: countSchema,
    listing: z.enum(LISTING_STATES),
    actors: z.array(actorSchema).max(STORED_LIMITS.actors),
    unlinked: z.array(unlinkedSchema).max(STORED_LIMITS.unlinked),
    advisories: z.array(advisorySchema).max(STORED_LIMITS.advisories),
    omitted: omittedSchema.optional(),
  })
  .refine(hasPolicyOrNeither, { message: 'documentId and activeMajor are both set or both null.' })
  .refine(outcomeMatchesCodes, { message: 'The outcome is success exactly when failureCodes is empty.' });

export type PrEvaluationDetails = z.infer<typeof PrEvaluationDetails>;

export type StoredDetailsResult = { readonly ok: true; readonly details: PrEvaluationDetails } | { readonly ok: false };

/**
 * Reads a `pr_evaluations.details` value. It never throws: a value that is not this version's shape (an old row, a row
 * still `in_progress` with `{}`, a newer version, junk) returns `{ ok: false }`, so one bad row cannot break a page.
 */
export function parseStoredDetails(value: unknown): StoredDetailsResult {
  try {
    const parsed = PrEvaluationDetails.safeParse(value);
    return parsed.success ? { ok: true, details: parsed.data } : { ok: false };
  } catch {
    // A value from JSON.parse cannot throw here; an object with a throwing getter or a revoked proxy can, and the
    // contract is that reading never fails. The error is dropped on purpose: it may quote the offending value.
    return { ok: false };
  }
}
