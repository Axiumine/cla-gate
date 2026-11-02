// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { githubIdSchema } from '../../../shared/github-id.ts';

// The schemas of GitHub's answers (E05-S02). Each keeps only the fields the platform uses and drops the rest, so an
// answer that grows a field is still read and nothing we do not need is held. Later stories add the schemas of their
// own routes here (E05-S04). A schema that renames or reshapes (`full_name` to `fullName`) produces the type the port
// (src/server/services/ports/github.ts) declares, so no caller sees GitHub's field names.

/** The account types an App can be installed on or owned by. Anything else fails validation. */
const accountTypeSchema = z.enum(['User', 'Organization']);

export type AccountType = z.infer<typeof accountTypeSchema>;

/**
 * `GET /app`: the App the JWT belongs to. `owner` is the account that owns the App; GitHub sends `null` for an App owned
 * by an enterprise, which fails here on purpose, because the admission policy needs an owner id (E05-S07).
 */
export const appSchema = z.object({
  id: githubIdSchema,
  slug: z.string().min(1),
  owner: z.object({ id: githubIdSchema, type: accountTypeSchema }),
  permissions: z.record(z.string(), z.string()),
});

export type AppResponse = z.infer<typeof appSchema>;

/**
 * `POST /app/installations/{id}/access_tokens` (E05-S03). `token` is a credential: it is parsed here and held as a
 * `Secret` right after, and a failure of this schema names paths, never values. GitHub sends `expires_at` as
 * `2016-07-11T22:14:10Z`; an offset is accepted too, since both name one instant.
 */
export const installationTokenSchema = z.object({
  token: z.string().min(1),
  expires_at: z.iso.datetime({ offset: true }),
});

export type InstallationTokenResponse = z.infer<typeof installationTokenSchema>;

/** A user or an organisation: the accounts the platform can serve. */
const knownAccountSchema = z.object({ id: githubIdSchema, login: z.string().min(1), type: accountTypeSchema });

/**
 * Any other account an installation belongs to (an enterprise has a `slug` and no `login`, and no `type` of ours): only
 * the numeric id is needed. It is read as `Other` so that one such installation is recorded as rejected and never
 * served, instead of failing the whole list of installations for every tenant. A user or organisation whose `login` is
 * missing is read this way too, and so refused: failing closed. The name is a display snapshot, never an identity.
 */
const otherAccountSchema = z
  .object({ id: githubIdSchema, login: z.string().min(1).optional(), slug: z.string().min(1).optional() })
  .transform(({ id, login, slug }) => ({ id, login: login ?? slug ?? `account-${id}`, type: 'Other' as const }));

/** An account an installation belongs to; the first schema that fits wins, so only a known account is read as one. */
const accountSchema = z.union([knownAccountSchema, otherAccountSchema]);

/** A GitHub timestamp as a `Date`: `2026-11-02T10:00:00Z`, or with an offset. */
const timestampSchema = z.iso.datetime({ offset: true }).transform((text) => new Date(text));

/**
 * One installation, from `GET /app/installations/{id}` and each entry of `GET /app/installations`. `suspended_at` is
 * required (null while active): an answer without it is not read as "not suspended".
 */
export const installationSchema = z
  .object({
    id: githubIdSchema,
    account: accountSchema,
    suspended_at: timestampSchema.nullable(),
    permissions: z.record(z.string(), z.string()),
  })
  .transform(({ id, account, suspended_at, permissions }) => ({
    id,
    account,
    suspendedAt: suspended_at,
    permissions,
  }));

/** `GET /app/installations?per_page=100`: one page, a bare array. */
export const installationPageSchema = z.array(installationSchema);

/** One repository, from `GET /repositories/{id}` and each entry of `GET /installation/repositories`. */
export const repositorySchema = z
  .object({ id: githubIdSchema, full_name: z.string().min(1) })
  .transform(({ id, full_name }) => ({ id, fullName: full_name }));

/** `GET /installation/repositories?per_page=100`: one page, as its repositories. `total_count` is not used: the pages are followed. */
export const repositoryPageSchema = z
  .object({ repositories: z.array(repositorySchema) })
  .transform((page) => page.repositories);

/** `GET /orgs/{org}/memberships/{username}`: whether and how a person belongs to an organisation. */
export const orgMembershipSchema = z
  .object({
    state: z.enum(['active', 'pending']),
    role: z.enum(['admin', 'member', 'billing_manager']),
    user: z.object({ id: githubIdSchema }),
  })
  .transform(({ state, role, user }) => ({ state, role, userId: user.id }));

/**
 * `GET /repos/{owner}/{repo}/collaborators/{username}/permission` (E11-S03): the base `permission` of a person on a
 * repository and their numeric id. `role_name` is dropped on purpose: a custom role maps onto the base `permission`, and the
 * name of a role is a label a maintainer can choose.
 */
export const repositoryPermissionSchema = z
  .object({
    permission: z.enum(['admin', 'maintain', 'write', 'triage', 'read', 'none']),
    user: z.object({ id: githubIdSchema }),
  })
  .transform(({ permission, user }) => ({ permission, userId: user.id }));
