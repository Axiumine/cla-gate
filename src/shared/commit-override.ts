// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';

// The contract of the per-commit override (E15-S05): the path, the body of the request that records one and the answer. The route, its
// tests and the screen that records an override (E18) share it. An override waives the check for the author and committer of one
// commit whose email GitHub cannot link to an account; it never implies a signature, and the pull request opener and every other
// commit still have to be covered (E08).

/** `POST`: record an override for a commit of a repository (E15-S05). `:repositoryId` is `repositories.id`. */
export const COMMIT_OVERRIDES_PATH = '/api/repositories/:repositoryId/commit-overrides';

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
