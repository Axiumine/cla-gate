// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { defineRoute } from './contract.ts';

// What the instance says about itself to anyone who asks (E17-S09): where its source code is and which commit runs, so the
// footer of every page can offer the corresponding source of the exact running version (AGPL section 13), and the address
// that installs the GitHub App. The server answers `GET /api/meta` from these schemas and the web app parses the answer with
// the same ones. This module imports neither src/server nor src/web.

/** The repository the footer links to when the instance was told no other, and when `/api/meta` cannot be read. */
export const DEFAULT_SOURCE_URL = 'https://github.com/Axiumine/cla-gate';

/** How long a browser or a proxy may keep the answer: the commit changes only with a new deployment. */
export const META_CACHE_CONTROL = 'public, max-age=300';

/** Printable ASCII only: an address with a space, a control character or a non-ASCII character in it is not one we wrote. */
const PRINTABLE_ASCII = /^[!-~]+$/u;

/** Whether `value` is an address that a path can be appended to, and that is safe to use as an `href`. */
function isPlainHttpsUrl(value: string): boolean {
  if (!PRINTABLE_ASCII.test(value) || value.includes('?') || value.includes('#') || value.endsWith('/')) {
    return false;
  }
  if (!URL.canParse(value)) {
    return false;
  }
  const url = new URL(value);
  return url.protocol === 'https:' && url.username === '' && url.password === '';
}

/**
 * The address of the source code: `https`, no credentials, no query, no fragment and no trailing slash, so that
 * `<sourceUrl>/tree/<commit>` is a link. A `javascript:` or `data:` address, `http` and `https://user:pw@host` are refused.
 */
export const sourceUrlSchema = z.string().refine(isPlainHttpsUrl);

/** A full Git commit id, as `git rev-parse HEAD` prints it: 40 lower-case hexadecimal characters. */
export const commitSchema = z.string().regex(/^[0-9a-f]{40}$/u);

/** The slug of a GitHub App: lower-case letters, digits and hyphens. */
const appSlugSchema = z.string().regex(/^[a-z0-9-]+$/u);

const INSTALL_URL = /^https:\/\/github\.com\/apps\/[a-z0-9-]+\/installations\/new$/u;

/**
 * The page where an account installs the App, `https://github.com/apps/<slug>/installations/new`, or `null` when `slug`
 * is not one (the slug comes from GitHub, but nothing odd is ever put in an address).
 */
export function installUrlFor(slug: string): string | null {
  const parsed = appSlugSchema.safeParse(slug);
  return parsed.success ? `https://github.com/apps/${parsed.data}/installations/new` : null;
}

/**
 * `GET /api/meta` answers with this. `installUrl` is `null` until the App is configured and verified.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode); the routes use `metaRoute`.
 */
export const metaResponseSchema = z.object({
  sourceUrl: sourceUrlSchema,
  commit: commitSchema.nullable(),
  installUrl: z.string().regex(INSTALL_URL).nullable(),
});

export type MetaResponse = z.infer<typeof metaResponseSchema>;

/**
 * `GET /api/meta` (E17-S09): public, no session, no side effect. The server registers it and the web client calls it from
 * this descriptor.
 */
export const metaRoute = defineRoute({
  method: 'GET',
  path: '/api/meta',
  responses: { 200: metaResponseSchema },
});

/**
 * Where the corresponding source of the running version is: the tree of `commit` in the repository at `sourceUrl`, or the
 * repository itself when the commit is not known.
 */
export function sourceCodeUrl(sourceUrl: string, commit: string | null): string {
  return commit === null ? sourceUrl : `${sourceUrl}/tree/${commit}`;
}
