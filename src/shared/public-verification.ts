// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { githubIdSchema } from './github-id.ts';

// The contract of the public signature check (E22-S02): the opt-in call of a maintainer, and the public question "does this login
// have a valid signature for this repository". The routes, their tests and the badge routes of E22-S03 share them. The public
// call names the repository by GitHub's numeric id (`githubRepoId`, the id of the repository on GitHub), the one thing a project
// knows about itself from outside; the opt-in names it by `repositories.id`, like the other settings of a repository.

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
