// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { defineRoute } from './contract.ts';

// The first-run setup API (E19-S06): while no GitHub App is configured the server offers a one-time flow that creates the
// App through GitHub's app-manifest flow. The server registers its routes from these descriptors and the setup page of the
// web app (E19-S07) calls them through the same ones. This module imports neither src/server nor src/web.

/**
 * A GitHub login as GitHub writes the rule: 1 to 39 letters, digits and hyphens, the first and the last not a hyphen. The
 * setup page (E19-S07) mirrors it in its form.
 * @internal Exported for the setup page and the unit tests (Knip ignores `@internal` exports in production mode).
 */
// eslint-disable-next-line security/detect-unsafe-regex -- the rule of GitHub itself: one bounded repetition ({0,37}) and no nesting, so no input can make it backtrack
export const GITHUB_LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;

/**
 * The name of a GitHub App as the setup accepts it: 1 to 34 letters, digits, spaces and hyphens, nothing a URL or a page
 * would read. The setup page (E19-S07) mirrors it in its form.
 * @internal Exported for the setup page and the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const APP_NAME_PATTERN = /^[A-Za-z0-9 -]{1,34}$/u;

/** The longest token the unlock reads: far above the 32 characters the configuration demands, and still a small body. */
const MAX_TOKEN_LENGTH = 512;

/** A random 256-bit value as base64url: exactly 43 characters. The setup `state` and the CSRF token of the setup session. */
const RANDOM_VALUE = /^[A-Za-z0-9_-]{43}$/u;

/**
 * The codes the setup routes answer with besides the standard ones, for the message catalog of the setup page (E19-S07): a
 * wrong token, a request that carries no live setup session, and an `Origin` that is not this instance's own (E19-S06); and
 * the four of the conversion (E19-S11): GitHub's code that is no longer good, a second conversion, GitHub that could not be
 * reached and GitHub's answer that cannot be read.
 */
export const SETUP_ERROR_CODES = {
  invalidToken: 'invalid_setup_token',
  locked: 'setup_locked',
  originMismatch: 'origin_mismatch',
  codeInvalid: 'setup_code_invalid',
  alreadyIssued: 'setup_already_issued',
  githubUnreachable: 'github_unreachable',
  githubUnexpected: 'github_unexpected_response',
} as const;

/** `GET /api/setup/status` answers with this: `setup` while the first-run flow is on offer, `configured` once the App is. */
export const setupStatusSchema = z.object({ mode: z.enum(['setup', 'configured']) });

/** The body of `POST /api/setup/unlock`: the token of `secrets/setup_token`. Unknown keys are a 400. */
export const unlockRequestSchema = z.strictObject({ token: z.string().min(1).max(MAX_TOKEN_LENGTH) });

/** What a successful unlock answers: the token the page sends in `x-csrf-token` on every other setup `POST`. */
export const unlockResponseSchema = z.object({ csrfToken: z.string().regex(RANDOM_VALUE) });

const appName = z.string().regex(APP_NAME_PATTERN);

/**
 * The body of `POST /api/setup/manifest` (zod, E19-S06): who owns the App, what it is called and whether other accounts may
 * install it. An organisation login must follow GitHub's rule, and a personal App carries none; any other key is a 400, so
 * nothing but what is listed here ever reaches the manifest or the address it is posted to.
 */
export const manifestRequestSchema = z.discriminatedUnion('ownerType', [
  z.strictObject({ ownerType: z.literal('user'), appName, allowOtherAccounts: z.boolean() }),
  z.strictObject({
    ownerType: z.literal('organisation'),
    organisation: z.string().regex(GITHUB_LOGIN_PATTERN),
    appName,
    allowOtherAccounts: z.boolean(),
  }),
]);

export type ManifestRequest = z.infer<typeof manifestRequestSchema>;

/**
 * The App manifest GitHub reads (E19-S06): the settings the App is created with, under the names of GitHub's manifest reference.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const appManifestSchema = z.object({
  name: z.string(),
  url: z.string(),
  hook_attributes: z.object({ url: z.string(), active: z.boolean() }),
  redirect_url: z.string(),
  callback_urls: z.array(z.string()),
  setup_url: z.string(),
  setup_on_update: z.boolean(),
  public: z.boolean(),
  request_oauth_on_install: z.boolean(),
  default_permissions: z.record(z.string(), z.enum(['read', 'write'])),
  default_events: z.array(z.string()),
});

export type AppManifest = z.infer<typeof appManifestSchema>;

/** Where the manifest is posted: GitHub's page for a personal App or for one of an organisation, with the `state` in the query. */
const ACTION_URL =
  /^https:\/\/github\.com\/(?:settings\/apps\/new|organizations\/[A-Za-z0-9-]{1,39}\/settings\/apps\/new)\?state=[A-Za-z0-9_-]{43}$/u;

/**
 * What `POST /api/setup/manifest` answers with: the address to post the manifest to, the manifest, and the `state` that
 * GitHub sends back to the setup page (bound to the unlock session, single use).
 */
export const manifestResponseSchema = z.object({
  actionUrl: z.string().regex(ACTION_URL),
  manifest: appManifestSchema,
  state: z.string().regex(RANDOM_VALUE),
});

/**
 * The one-time code GitHub sends back to the setup page: letters and digits, at most 64 (E19-S11). The setup page checks the
 * address it was opened at against it before it offers the conversion.
 *
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const SETUP_CODE_PATTERN = /^[A-Za-z0-9]{1,64}$/u;

/**
 * The `state` GitHub echoes to the setup page: the 43 base64url characters the manifest answer carried (E19-S06).
 * @internal Exported for the setup page and the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const SETUP_STATE_PATTERN = RANDOM_VALUE;

/**
 * The body of `POST /api/setup/convert` (E19-S11): the `code` and the `state` that GitHub put in the address of the setup
 * page. Unknown keys are a 400.
 */
export const convertRequestSchema = z.strictObject({
  code: z.string().regex(SETUP_CODE_PATTERN),
  state: z.string().regex(RANDOM_VALUE),
});

/**
 * What the conversion answers with, once (E19-S11): the App's identity and its credentials. The values are checked for being
 * there and nothing more: the credentials are single-use, so a value that is odd must still reach the operator. The page
 * validates `slug` and `htmlUrl` itself before it builds a link from either (E19-S07), and builds the install link from the
 * slug and not from `installUrl`.
 */
export const convertResponseSchema = z.object({
  appId: z.number().int().positive(),
  slug: z.string().min(1),
  htmlUrl: z.string().min(1),
  installUrl: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  webhookSecret: z.string().min(1),
  privateKeyPem: z.string().min(1),
});

/** `GET /api/setup/status` (E19-S06): public, always registered; `configured` leaves every other setup route unregistered. */
export const setupStatusRoute = defineRoute({
  method: 'GET',
  path: '/api/setup/status',
  responses: { 200: setupStatusSchema },
});

/**
 * `POST /api/setup/unlock` (E19-S06): the setup token in, a `__Host-cla_setup` cookie and the CSRF token of that session out.
 * The answer is `200` with the token in the body, and not `204`: a `204` has no body to carry it.
 */
export const setupUnlockRoute = defineRoute({
  method: 'POST',
  path: '/api/setup/unlock',
  body: unlockRequestSchema,
  responses: { 200: unlockResponseSchema },
});

/** `POST /api/setup/manifest` (E19-S06): needs the setup cookie, the CSRF token and the `Origin` of this instance. */
export const setupManifestRoute = defineRoute({
  method: 'POST',
  path: '/api/setup/manifest',
  body: manifestRequestSchema,
  responses: { 200: manifestResponseSchema },
});

/**
 * `GET /api/setup/session` (E19-S07): the CSRF token of the setup session the cookie names, for a page that was loaded after
 * the unlock. GitHub sends the browser back to the setup page after a full-page round trip, which has lost the token the
 * unlock answered with; the cookie has not been lost, and this is how the page gets the token again (like the session
 * endpoint of E10 does for a login). `401 setup_locked` when the cookie names no live session.
 */
export const setupSessionRoute = defineRoute({
  method: 'GET',
  path: '/api/setup/session',
  responses: { 200: unlockResponseSchema },
});

/** `POST /api/setup/convert` (E19-S11): needs the setup cookie, the CSRF token and the `Origin` of this instance. */
export const setupConvertRoute = defineRoute({
  method: 'POST',
  path: '/api/setup/convert',
  body: convertRequestSchema,
  responses: { 200: convertResponseSchema },
});
