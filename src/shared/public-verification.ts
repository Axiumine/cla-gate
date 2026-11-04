// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { defineRoute } from './contract.ts';
import { githubIdSchema } from './github-id.ts';

// The contract of the public signature check (E22-S02) and of its badges (E22-S03): the opt-in call of a maintainer, the public
// question "does this login have a valid signature for this repository", the two badges drawn from the same answer, and the
// snippet a maintainer pastes into a README. The routes, their tests and the settings screen share them. The public calls name
// the repository by GitHub's numeric id (`githubRepoId`, the id of the repository on GitHub), the one thing a project knows about
// itself from outside; the opt-in and the snippet name it by `repositories.id`, like the other settings of a repository.

/**
 * `PUT`: turn the public signature check on or off for a repository (E22-S02). `:installationId` and `:repositoryId` are
 * `installations.id` and `repositories.id`, never GitHub's ids.
 */
export const PUBLIC_VERIFICATION_PATH =
  '/api/installations/:installationId/repositories/:repositoryId/public-verification';

/**
 * `GET`: does `:login` have a valid signature for the repository `:githubRepoId` (E22-S02). Public: no session, no cookie. The
 * access log records this very template and never the concrete login.
 */
export const PUBLIC_SIGNER_PATH = '/api/public/repos/:githubRepoId/signers/:login';

/**
 * `GET`: the badge of a project that opted in, "CLA | required" (E22-S03). Public: no session, no cookie. It is the same `404
 * not_found` as {@link PUBLIC_SIGNER_PATH} for a repository that may not be asked about.
 */
export const PUBLIC_BADGE_PATH = '/api/public/repos/:githubRepoId/badge.svg';

/**
 * `GET`: the badge of one signer, "CLA | signed" or "CLA | not signed" (E22-S03), from the same decision as
 * {@link PUBLIC_SIGNER_PATH}. Public: no session, no cookie. The access log records this very template and never the login.
 */
export const PUBLIC_SIGNER_BADGE_PATH = '/api/public/repos/:githubRepoId/signers/:login/badge.svg';

/**
 * `GET`: the Markdown and the HTML a maintainer pastes into a README to show the project badge (E22-S03). Same role as the opt-in;
 * `409 public_verification_disabled` while the opt-in is off. `:installationId` and `:repositoryId` are row ids, as for the opt-in.
 */
export const BADGE_SNIPPET_PATH = '/api/installations/:installationId/repositories/:repositoryId/badge-snippet';

/** Where the public API lives. The access log writes the route template, not the path, for every route below it. */
export const PUBLIC_API_PREFIX = '/api/public/';

/** The body of the opt-in call. Strict: a key nobody defined (an `installationId`, say) is a `400` and never quietly ignored. */
export const publicVerificationRequestSchema = z.strictObject({ enabled: z.boolean() });

/**
 * The answer to the opt-in call: whether the check is on now, and whether the call changed it. `changed: false` is the answer
 * to a call that asked for what already was; it wrote no audit row.
 */
export const publicVerificationResponseSchema = z.object({ enabled: z.boolean(), changed: z.boolean() });

/**
 * A login as GitHub allows it: 1 to 39 letters, digits and hyphens, no hyphen first or last and never two in a row. The lookahead
 * `(?!.*--)` is bounded by the length of a path parameter, and every other part is a fixed run of one character class.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const PUBLIC_LOGIN_PATTERN = /^(?!-)(?!.*--)[A-Za-z0-9-]{0,38}[A-Za-z0-9]$/;

/**
 * The path parameters of the public call, read from the strings of the path: `githubRepoId` is a positive safe integer in plain
 * digits (no sign, no leading zero, no exponent), `login` has the shape of {@link PUBLIC_LOGIN_PATTERN}. Anything else is a `400
 * invalid_input`, which the route answers before it reads the database, so the answer says nothing about any repository.
 */
export const publicSignerParamsSchema = z.object({
  githubRepoId: z
    .string()
    .regex(/^[1-9]\d{0,15}$/)
    .transform(Number)
    .pipe(githubIdSchema),
  login: z.string().regex(PUBLIC_LOGIN_PATTERN),
});

/**
 * The only answer the public call gives: `signed` is true when the login's current numeric id has an unrevoked individual
 * signature on the active CLA of the repository at its active major. It carries no name, no e-mail, no date, no version, no
 * document and no id; a login that never signed, one that was revoked, one that signed an older major and one that does not exist
 * all give `{ "signed": false }`.
 */
export const publicSignerResponseSchema = z.strictObject({ signed: z.boolean() });

/** The path parameter of the calls that name a repository alone (the project badge): `githubRepoId`, read as in {@link publicSignerParamsSchema}. */
export const publicRepositoryParamsSchema = publicSignerParamsSchema.pick({ githubRepoId: true });

/**
 * What a maintainer pastes into a README (E22-S03): the project badge as a Markdown image inside a link, and the same as HTML.
 * Both link to the sign page of the repository. Built by the server from `PUBLIC_BASE_URL` and the repository's GitHub id, so
 * they hold no name, no login and nothing a person typed.
 */
export const badgeSnippetResponseSchema = z.strictObject({ markdown: z.string(), html: z.string() });

/** The ids the maintainer's calls name: both are row ids, positive integers (the web app reads them from the address of the screen). */
const settingsParamsSchema = z.object({ installationId: z.int().positive(), repositoryId: z.int().positive() });

/** `PUT` {@link PUBLIC_VERIFICATION_PATH}: the descriptor the settings screen calls the opt-in with (E22-S03). */
export const publicVerificationRoute = defineRoute({
  method: 'PUT',
  path: PUBLIC_VERIFICATION_PATH,
  params: settingsParamsSchema,
  body: publicVerificationRequestSchema,
  responses: { 200: publicVerificationResponseSchema },
});

/** `GET` {@link BADGE_SNIPPET_PATH}: the descriptor the settings screen reads the snippet with (E22-S03). */
export const badgeSnippetRoute = defineRoute({
  method: 'GET',
  path: BADGE_SNIPPET_PATH,
  params: settingsParamsSchema,
  responses: { 200: badgeSnippetResponseSchema },
});
