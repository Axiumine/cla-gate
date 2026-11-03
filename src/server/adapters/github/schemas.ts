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

/** The lower-case commit SHA of a SHA-1 or SHA-256 repository. */
const commitShaSchema = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);

/** The account types of a pull request opener or a commit's linked account. Anything else fails validation. */
const commitAccountTypeSchema = z.enum(['User', 'Bot', 'Organization', 'Mannequin']);

/** A linked account of a pull request or a commit: the numeric id, the login (a lookup handle) and the type. */
const accountRefSchema = z.object({ id: githubIdSchema, login: z.string().min(1), type: commitAccountTypeSchema });

/**
 * The author or committer of a commit as GitHub links it. GitHub sends `null`, or `{}`, for an identity it could not
 * link, and an object without a numeric id is no account either: all of them, and anything else that is not an account
 * we can name, read as `null`, an unlinked identity, which fails closed (E07-S10, E08-S02).
 */
const linkedAccountSchema = z.union([accountRefSchema, z.unknown().transform(() => null)]);

/** `GET /repos/{owner}/{repo}/pulls/{pull_number}`: only what the evaluation reads. */
export const pullRequestSchema = z
  .object({
    number: z.int().positive(),
    state: z.enum(['open', 'closed']),
    draft: z.boolean().default(false),
    head: z.object({ sha: commitShaSchema }),
    base: z.object({ sha: commitShaSchema }),
    user: accountRefSchema,
    commits: z.int().nonnegative(),
  })
  .transform(({ number, state, draft, head, base, user, commits }) => ({
    number,
    state,
    draft,
    headSha: head.sha,
    baseSha: base.sha,
    opener: user,
    commitCount: commits,
  }));

/** A git identity (the name and email a commit was written with): display only. */
const gitIdentitySchema = z.object({ name: z.string(), email: z.string() });

/** One entry of a commit listing, from `GET .../pulls/{n}/commits` and `GET .../commits`. */
const commitSchema = z
  .object({
    sha: commitShaSchema,
    parents: z.array(z.object({ sha: commitShaSchema })),
    author: linkedAccountSchema.optional(),
    committer: linkedAccountSchema.optional(),
    commit: z.object({ message: z.string(), author: gitIdentitySchema, committer: gitIdentitySchema }),
  })
  .transform(({ sha, parents, author, committer, commit }) => ({
    sha,
    parents: parents.map((parent) => parent.sha),
    author: author ?? null,
    committer: committer ?? null,
    message: commit.message,
    rawAuthor: commit.author,
    rawCommitter: commit.committer,
  }));

/** One page of a commit listing: a bare array. */
export const commitPageSchema = z.array(commitSchema);

/** `GET /repos/{owner}/{repo}/compare/{base}...{head}`: the merge base commit, the only field used. */
export const comparisonSchema = z
  .object({ merge_base_commit: z.object({ sha: commitShaSchema }) })
  .transform(({ merge_base_commit }) => ({ mergeBaseSha: merge_base_commit.sha }));

/**
 * The kind of account that wrote a comment. A type the platform has no word for (an enterprise account) reads as `Other`
 * instead of failing the answer: only `Bot` matters, and a comment of an unknown kind is not a bot's.
 */
const commentAuthorTypeSchema = z.union([
  z.enum(['User', 'Bot', 'Organization', 'Mannequin']),
  z.unknown().transform(() => 'Other' as const),
]);

/**
 * `GET /repos/{owner}/{repo}/issues/comments/{comment_id}` (E07-S07): the text, the author and the number of the issue the comment is
 * on, which is the last segment of `issue_url`. A missing body reads as empty, which is no command. An answer without a
 * usable `issue_url` is not read: the number is what ties a comment to a pull request.
 */
export const issueCommentSchema = z
  .object({
    id: githubIdSchema,
    body: z.string().default(''),
    user: z.object({ id: githubIdSchema, type: commentAuthorTypeSchema }).nullable(),
    issue_url: z.string().regex(/\/issues\/[1-9]\d{0,9}$/),
  })
  .transform(({ id, body, user, issue_url }) => ({
    id,
    body,
    author: user,
    issueNumber: Number(issue_url.slice(issue_url.lastIndexOf('/') + 1)),
  }));

/**
 * `GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls` (E07-S07) and `GET /repos/{owner}/{repo}/pulls` (E07-S08): one page,
 * as the pull requests' number, state and head SHA.
 */
export const pullRequestRefPageSchema = z.array(
  z
    .object({
      number: z.int().positive(),
      state: z.enum(['open', 'closed']),
      head: z.object({ sha: commitShaSchema }),
    })
    .transform(({ number, state, head }) => ({ number, state, headSha: head.sha })),
);

/**
 * The state of a Check Run (E09-S05). GitHub names more than the three the platform tells apart for the runs of other Apps
 * (`waiting`, `requested`, `pending`); a state nobody here has a word for reads as `queued`, which is not completed, instead
 * of failing the listing of a head SHA that another App also reports on.
 */
const checkStatusSchema = z.union([
  z.enum(['queued', 'in_progress', 'completed']),
  z.unknown().transform(() => 'queued' as const),
]);

/**
 * One Check Run, from `POST` and `PATCH .../check-runs`, `GET .../check-runs/{id}` and each entry of the listing of a commit
 * (E09-S05): the id, the commit, the state, the App that posted it (`app` is null for a run whose App was deleted) and the
 * `external_id` of the creator. The output, the conclusion and the times are dropped: nothing reads them back.
 */
export const checkRunSchema = z
  .object({
    id: githubIdSchema,
    head_sha: commitShaSchema,
    status: checkStatusSchema,
    external_id: z.string().nullish(),
    app: z.object({ id: githubIdSchema }).nullish(),
  })
  .transform(({ id, head_sha, status, external_id, app }) => ({
    id,
    headSha: head_sha,
    status,
    appId: app?.id ?? null,
    externalId: external_id ?? null,
  }));

/** `GET /repos/{owner}/{repo}/commits/{ref}/check-runs`: one page, as its runs. `total_count` is not used. */
export const checkRunPageSchema = z
  .object({ check_runs: z.array(checkRunSchema) })
  .transform((page) => page.check_runs);
