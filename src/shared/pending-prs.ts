// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { githubIdSchema } from './github-id.ts';
import { FAILURE_CODES } from './pr-evaluation-codes.ts';
import { shaSchema } from './pr-evaluation-parts.ts';
import { prNumberSchema } from './sign-context.ts';

// The pending pull requests of a tenant (E15-S07): the path, the closed list of reasons and the shape of a page. The route, its tests
// and the screen that lists them (E18) share them. The query string is read by the route
// (src/server/adapters/http/pending-prs-query.ts), because the cursor format is the server's own.

/**
 * Where a maintainer sees the open pull requests that `license/cla` blocks: `:installationId` is `installations.id`, the tenant key of
 * our own tables, never GitHub's installation id (E11-S05).
 */
export const PENDING_PRS_PATH = '/api/installations/:installationId/pending-prs';

/**
 * Why a pull request is pending, as the list tells it: the five failure codes of the engine (E08-S01), in that order, and `other` for
 * a failed evaluation that names none (the dead-letter write of E07-S05, and any code this version does not know).
 */
export const PENDING_REASON_CODES = [...FAILURE_CODES, 'other'] as const;

export type PendingReasonCode = (typeof PENDING_REASON_CODES)[number];

const id = z.int().positive();

/** An instant as ISO 8601 in UTC with milliseconds, which is what `Date.prototype.toISOString` writes. */
const instant = z.iso.datetime({ offset: false });

/**
 * One reason a pull request is pending. `githubId` names the uncovered account (`unsigned_contributor`, `bot_not_allowlisted`) and
 * `commitSha` the commit with an unlinked identity that no override waives (`unlinked_identity`); each is present only where it
 * applies. `login` comes with a `githubId`: the display snapshot of that account when this instance has a row for it (an erased person
 * shows `erased-<id>`), `null` when it has none, because the stored details hold no login. It is returned as stored, not escaped.
 */
const pendingReasonSchema = z
  .strictObject({
    code: z.enum(PENDING_REASON_CODES),
    githubId: githubIdSchema.optional(),
    login: z.string().nullable().optional(),
    commitSha: shaSchema.optional(),
  })
  .refine((reason) => (reason.login !== undefined) === (reason.githubId !== undefined), {
    message: 'login comes with githubId and only with it',
  });

/** One pending pull request: its latest evaluation (the Check Run id is `null` until the reporter has one) and why it fails. */
const pendingPrSchema = z.strictObject({
  evaluationId: id,
  repository: z.strictObject({ id, fullName: z.string() }),
  prNumber: prNumberSchema,
  headSha: z.string(),
  evaluatedAt: instant,
  checkRunId: id.nullable(),
  reasons: z.array(pendingReasonSchema).min(1),
});

/**
 * A page of the list, the most recently evaluated first. `nextCursor` is opaque and is `null` on the last page. `truncated` is `true`
 * when the viewer, who is a repository admin and not an org admin, has more repositories with pending pull requests than one request
 * checks (50): the page then lists the ones that were checked, and `repositoryId` names the one to look at.
 */
export const pendingPrsPageSchema = z.strictObject({
  items: z.array(pendingPrSchema),
  nextCursor: z.string().nullable(),
  truncated: z.boolean(),
});

export type PendingPrsPage = z.infer<typeof pendingPrsPageSchema>;
