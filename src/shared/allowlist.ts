// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { githubIdSchema } from './github-id.ts';

// The contract of the allowlist (epic E14): the paths, the body that adds an entry and the entry as the API tells it. The
// server serialises with these schemas and the screens of E18 parse with them. An entry exempts an account by its numeric
// GitHub id (`github_id`, the only thing matching reads); the login is a display snapshot of what GitHub called that id when the
// entry was made, and it can be out of date after a rename (E14-S06).

/** `POST`: add an entry that exempts an account in every repository of the installation (E14-S06). `:installationId` is `installations.id`. */
export const INSTALLATION_ALLOWLIST_PATH = '/api/installations/:installationId/allowlist-entries';

/** `POST`: add an entry that exempts an account in one repository (E14-S06). `:repositoryId` is `repositories.id`, never GitHub's id. */
export const REPOSITORY_ALLOWLIST_PATH = '/api/repositories/:repositoryId/allowlist-entries';

/**
 * The shape of a GitHub login, bots included: a letter or digit, up to 38 more letters, digits or hyphens, and for a bot the
 * suffix `[bot]`. It is checked on the login a person types before any request is made, on the login GitHub answers with, and
 * by the database on the snapshot it stores (migration 012), so no markup travels from a response to a screen.
 */
export const ALLOWLIST_LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/;

const loginSchema = z.string().regex(ALLOWLIST_LOGIN_PATTERN);

/**
 * The body of an add. A union on `kind`, strict in each member: a key nobody defined (an `installationId`, a `githubId` the client
 * made up) is a `400`, and so is a login that does not look like one. `org_members` takes no login: the account is the
 * installation's own, which the server knows.
 */
export const allowlistEntryRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('user'), login: loginSchema }),
  z.strictObject({ kind: z.literal('bot'), login: loginSchema }),
  z.strictObject({ kind: z.literal('org_members') }),
]);

export type AllowlistEntryRequest = z.infer<typeof allowlistEntryRequestSchema>;

/** What an entry exempts: one account, or the members of the installation's own organisation. */
const allowlistKindSchema = z.enum(['user', 'bot', 'org_members']);

/**
 * One entry. `scope` follows `repositoryId` (null: the entry covers the installation). `githubId` is the identity;
 * `loginSnapshot` is for display only, null when the entry has none (after an erasure), and always the shape of a login.
 */
const allowlistEntrySchema = z.object({
  id: z.int().positive(),
  scope: z.enum(['installation', 'repository']),
  repositoryId: z.int().positive().nullable(),
  kind: allowlistKindSchema,
  githubId: githubIdSchema,
  loginSnapshot: loginSchema.nullable(),
  createdBy: z.object({ githubId: githubIdSchema }),
  createdAt: z.iso.datetime(),
});

/** `201` of the add: the entry that was made. */
export const allowlistEntryResponseSchema = z.object({ entry: allowlistEntrySchema });
