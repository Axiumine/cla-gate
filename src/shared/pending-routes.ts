// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { PAGE_SIZE } from './cla.ts';
import {
  COMMIT_OVERRIDE_PATH,
  COMMIT_OVERRIDES_PATH,
  commitOverridePageSchema,
  commitOverrideRequestSchema,
  commitOverrideResponseSchema,
} from './commit-override.ts';
import { defineRoute } from './contract.ts';
import { installationParamsSchema } from './installations.ts';
import { PENDING_PRS_PATH, PENDING_REASON_CODES, pendingPrsPageSchema } from './pending-prs.ts';
import { shaSchema } from './pr-evaluation-parts.ts';

// The route descriptors of the pending pull requests (E15-S07) and the commit overrides (E15-S05, E15-S06) that the screen of E18-S08
// calls by: the paths and the schemas of the answers are those of pending-prs.ts and commit-override.ts, so the screen and the server
// cannot drift apart.

/** The longest `cursor` the server reads: the cursor it makes is about 70 characters, and a longer text is not one of its own. */
const MAX_CURSOR_LENGTH = 1024;

const id = z.int().positive();

/** A page of any list: `limit` of 1 to 100 and the `cursor` of the page before. */
const pageQueryShape = {
  limit: z.int().min(1).max(PAGE_SIZE.max).optional(),
  cursor: z.string().min(1).max(MAX_CURSOR_LENGTH).optional(),
};

/**
 * What the screen may ask the pending list for: a page, the repository to look at (`repositories.id`) and the reason a pull request has
 * to list. Any other key is an error here as it is a `400` at the server.
 */
const pendingPrsQuerySchema = z.strictObject({
  repositoryId: id.optional(),
  reason: z.enum(PENDING_REASON_CODES).optional(),
  ...pageQueryShape,
});

/** The path parameter of the routes of one repository: `repositories.id`, never GitHub's id. */
const repositoryParamsSchema = z.object({ repositoryId: id });

/** The path parameters of one override of a repository: the repository and `commit_overrides.id`. */
const overrideParamsSchema = repositoryParamsSchema.extend({ overrideId: id });

/**
 * The body of a record as the screen sends it: the commit id has to be the full one, 40 or 64 hexadecimal characters in lower case
 * (`shaSchema`, which is how the pending list tells it), so an abbreviated or otherwise unusable id never leaves the browser. The server
 * cleans the reason (E15-S05), and the screen sends it cleaned.
 */
const recordOverrideBodySchema = commitOverrideRequestSchema.extend({ commitSha: shaSchema });

/** `GET .../installations/:installationId/pending-prs` (E15-S07): the open pull requests of the tenant that `license/cla` blocks. */
export const pendingPrsRoute = defineRoute({
  method: 'GET',
  path: PENDING_PRS_PATH,
  params: installationParamsSchema,
  query: pendingPrsQuerySchema,
  responses: { 200: pendingPrsPageSchema },
});

/** `POST .../repositories/:repositoryId/commit-overrides` (E15-S05): waives the check for one commit whose email GitHub cannot link. */
export const recordOverrideRoute = defineRoute({
  method: 'POST',
  path: COMMIT_OVERRIDES_PATH,
  params: repositoryParamsSchema,
  body: recordOverrideBodySchema,
  responses: { 201: commitOverrideResponseSchema },
});

/** `GET .../repositories/:repositoryId/commit-overrides` (E15-S06): the overrides of one repository, newest first. */
export const listOverridesRoute = defineRoute({
  method: 'GET',
  path: COMMIT_OVERRIDES_PATH,
  params: repositoryParamsSchema,
  query: z.strictObject(pageQueryShape),
  responses: { 200: commitOverridePageSchema },
});

/** `DELETE .../repositories/:repositoryId/commit-overrides/:overrideId` (E15-S06): removes one override for good. */
export const removeOverrideRoute = defineRoute({
  method: 'DELETE',
  path: COMMIT_OVERRIDE_PATH,
  params: overrideParamsSchema,
  responses: { 204: z.undefined() },
});
