// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';

// The contract of the per-commit override (E15-S05, E15-S06): the paths, the body of the request that records one, the answer, the page
// of the list and the removal. The routes, their tests and the screens of the overrides (E18) share it. An override waives the check
// for the author and committer of one commit whose email GitHub cannot link to an account; it never implies a signature, and the pull
// request opener and every other commit still have to be covered (E08).

/** `POST`: record an override for a commit of a repository (E15-S05); `GET`: list them (E15-S06). `:repositoryId` is `repositories.id`. */
export const COMMIT_OVERRIDES_PATH = '/api/repositories/:repositoryId/commit-overrides';

/** `DELETE`: remove one override of a repository (E15-S06). `:overrideId` is `commit_overrides.id`. */
export const COMMIT_OVERRIDE_PATH = '/api/repositories/:repositoryId/commit-overrides/:overrideId';

/** A commit id as it is stored: 40 hexadecimal characters (SHA-1) or 64 (SHA-256), in lower case, the check on `commit_overrides.commit_sha`. */
const STORED_COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** The same as a person may type it: either case. */
const TYPED_COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

/**
 * The commit id an override is recorded under: `raw` in lower case when it is 40 or 64 hexadecimal characters, else `null`. An
 * abbreviated id, a branch name and anything with white space around it are not commit ids, so none is accepted: the server never
 * guesses which commit was meant.
 */
export function normaliseCommitSha(raw: string): string | null {
  return TYPED_COMMIT_SHA.test(raw) ? raw.toLowerCase() : null;
}

/**
 * The body of the request. Strict: a key nobody defined (an installation id, say) is a `400`. Both fields are cleaned by the server
 * (`normaliseCommitSha`, and the reason with the rules of any maintainer's note, E12-S04), so a value that cannot be one is a `422`
 * with its own code and not a `400`.
 */
export const commitOverrideRequestSchema = z.strictObject({ commitSha: z.string(), reason: z.string() });

/** The person who recorded an override: the numeric GitHub id and the login the `users` row holds now (a display snapshot). */
const overrideAuthorSchema = z.strictObject({ githubId: z.int().positive(), login: z.string() });

/** An override as the API tells it: times in ISO 8601 (UTC), the author by the numeric GitHub id, the reason as it was stored. */
const commitOverrideSchema = z.strictObject({
  id: z.int().positive(),
  repositoryId: z.int().positive(),
  commitSha: z.string().regex(STORED_COMMIT_SHA),
  reason: z.string().min(1),
  createdBy: overrideAuthorSchema,
  createdAt: z.iso.datetime({ offset: false }),
});

/** `201`: the override that was recorded. */
export const commitOverrideResponseSchema = z.strictObject({ override: commitOverrideSchema });

export type CommitOverrideResponse = z.infer<typeof commitOverrideResponseSchema>;

/**
 * One override of the list (E15-S06): the override of the answer to a record without the repository, which the path names. `reason` and
 * `createdBy.login` are returned as stored and are not escaped here (every screen escapes them for its own context, E17).
 */
const listedOverrideSchema = commitOverrideSchema.omit({ repositoryId: true });

/** `200` of the list: a page of the overrides of the repository, newest first. `nextCursor` is opaque and is `null` on the last page. */
export const commitOverridePageSchema = z.strictObject({
  items: z.array(listedOverrideSchema),
  nextCursor: z.string().nullable(),
});

export type CommitOverridePage = z.infer<typeof commitOverridePageSchema>;
