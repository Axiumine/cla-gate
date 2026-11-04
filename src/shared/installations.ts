// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { pageQuerySchema } from './cla.ts';

// What a maintainer sees of the installations and repositories they can administer (E14-S01): the two paths, the query of the
// repository list and the shape of both answers. The routes, their tests and the screens of the dashboard share them.

/** `GET`: the installations the signed-in person administers on this instance. `id` is `installations.id`, never GitHub's id. */
export const INSTALLATIONS_PATH = '/api/installations';

/** `GET`: the repositories of one installation that the signed-in person may see, one page at a time (E14-S01). */
export const INSTALLATION_REPOSITORIES_PATH = '/api/installations/:installationId/repositories';

/**
 * The longest `q` a request may carry: GitHub names a repository `owner/name` with at most 39 and 100 characters.
 * @internal exported for the tests of the query schema
 */
export const REPOSITORY_SEARCH_MAX_LENGTH = 140;

/** Text the database can store as it is: no lone surrogate and no NUL, which PostgreSQL refuses in `text`. */
const storableText = (text: string): boolean => text.isWellFormed() && !text.includes('\0');

/**
 * The query of the repository list: the `limit` of 1 to 100 (default 50) and the `cursor` of the page list, a case-insensitive
 * `q` substring of the full name, and `enabled` (`true` or `false`) to see only the repositories that enforce the CLA or only
 * those that do not. Strict: a parameter the list does not know is a `400`, never quietly ignored.
 */
export const repositoryListQuerySchema = pageQuerySchema.extend({
  q: z.string().min(1).max(REPOSITORY_SEARCH_MAX_LENGTH).refine(storableText).optional(),
  enabled: z
    .enum(['true', 'false'])
    .transform((text) => text === 'true')
    .optional(),
});

/**
 * The role the signed-in person has in an installation: `org_admin` for an admin of the organisation (or the owner of a user
 * account), `repo_admin` for an admin of a repository of it that carries a repo-scoped CLA document (E11-S03).
 */
const roleSchema = z.enum(['org_admin', 'repo_admin']);

/**
 * One installation the person administers. `accountLogin` is the display snapshot of the account. The counts are those of
 * the repositories GitHub still lists for the installation. `truncated` is `true` when the search for repository admins
 * ran into its limit of 100 repositories per request, across all installations (E14-S01): the list may then be missing
 * installations the person administers through a repository, and it says so on every row, because a list has no other place
 * for it.
 * @internal exported for the tests of the schema; the answer is read through {@link installationListSchema}
 */
export const installationSummarySchema = z.object({
  id: z.int().positive(),
  accountLogin: z.string(),
  accountType: z.enum(['Organization', 'User', 'Other']),
  role: roleSchema,
  suspended: z.boolean(),
  repositoryCount: z.int().min(0),
  enabledCount: z.int().min(0),
  truncated: z.boolean(),
});

/** `GET /api/installations`: the installations, by account login and id. */
export const installationListSchema = z.array(installationSummarySchema);

/**
 * The CLA document a repository enforces, as the list shows it: never its text (E14-S01).
 * @internal exported for the tests of the schema; the answer is read through {@link repositoryPageSchema}
 */
export const attachedDocumentSchema = z.object({
  id: z.int().positive(),
  name: z.string(),
  scope: z.enum(['installation', 'repository']),
  activeVersion: z.object({ major: z.int().min(1), minor: z.int().min(0) }).nullable(),
});

/**
 * One repository of the list. `id` is `repositories.id`, `githubRepoId` GitHub's id. `canAdminister` is the repository-action
 * rule of E14-S01 applied to the viewer: whether they may attach a document, enable and disable it, edit its allowlist.
 * @internal exported for the tests of the schema; the answer is read through {@link repositoryPageSchema}
 */
export const repositoryItemSchema = z.object({
  id: z.int().positive(),
  githubRepoId: z.int().positive(),
  fullName: z.string(),
  enabled: z.boolean(),
  canAdminister: z.boolean(),
  document: attachedDocumentSchema.nullable(),
});

/** `GET .../repositories`: one page, by full name and id; `nextCursor` is opaque and is `null` on the last page. */
export const repositoryPageSchema = z.object({
  items: z.array(repositoryItemSchema),
  nextCursor: z.string().nullable(),
});
