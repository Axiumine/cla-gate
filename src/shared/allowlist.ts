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

/** `GET` (the entries of the installation, E14-S07, the same path as the add) and `DELETE` (one entry of the tenant, whatever its scope): `:entryId` is `allowlist_entries.id`. */
export const ALLOWLIST_ENTRY_PATH = '/api/installations/:installationId/allowlist-entries/:entryId';

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

/** How many entries a page of the list holds when the request names no `limit` (E14-S07), and the most it may name. */
export const ALLOWLIST_PAGE_SIZE = { default: 100, max: 200 } as const;

/**
 * The query of the two lists (E14-S07): a plain-digit `limit` of 1 to 200 and the `cursor` an earlier page answered with. Strict:
 * a parameter nobody defined is a `400` and not one that is quietly ignored.
 */
export const allowlistQuerySchema = z.strictObject({
  limit: z
    .string()
    .regex(/^[1-9]\d{0,2}$/)
    .transform(Number)
    .pipe(z.int().max(ALLOWLIST_PAGE_SIZE.max))
    .optional(),
  cursor: z.string().min(1).max(1024).optional(),
});

/**
 * One entry of a list: the entry of `allowlistEntrySchema` with who made it by the numeric GitHub id and the login the `users`
 * row holds for them (a display snapshot like `loginSnapshot`, returned as stored). `readOnly` is true for an entry the list of a
 * repository shows because the installation made it: it is removed from the installation, not from the repository.
 */
const listedEntrySchema = allowlistEntrySchema.extend({
  createdBy: z.object({ githubId: githubIdSchema, login: z.string() }),
  readOnly: z.boolean(),
});

export type ListedEntryResponse = z.infer<typeof listedEntrySchema>;

/** `200` of `GET .../installations/:installationId/allowlist-entries`: the entries of the installation, and where the next page starts (null on the last page). */
export const allowlistPageSchema = z.object({
  entries: z.array(listedEntrySchema),
  nextCursor: z.string().nullable(),
});

/**
 * `200` of `GET .../repositories/:repositoryId/allowlist-entries`: the entries of the repository (`own`) and those of the
 * installation it inherits (`inherited`, all `readOnly`). A page holds at most `limit` entries in all, `own` before `inherited`.
 */
export const repositoryAllowlistPageSchema = z.object({
  own: z.array(listedEntrySchema),
  inherited: z.array(listedEntrySchema),
  nextCursor: z.string().nullable(),
});
