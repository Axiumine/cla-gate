// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { WEBHOOK_PATH } from '../../../shared/routes.ts';

// Which routes the CSRF and Origin check (E10-S03) does not cover. Two closed lists, each addition a reviewed edit with
// its own test: a route that runs its own checks is named here, and nothing else can opt out.

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Set on a route that the CSRF and Origin check skips. Only the routes of {@link CSRF_EXEMPT} may set it. */
    csrf?: 'exempt';
  }
}

/**
 * The routes that may set `config.csrf = 'exempt'` (`METHOD path`). The webhook authenticates by its HMAC alone.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const CSRF_EXEMPT: readonly string[] = [`POST ${WEBHOOK_PATH}`];

/**
 * The routes of the first-run setup (E19-S06). The manifest and the conversion (E19-S11) run their own cookie, CSRF token and
 * `Origin` check (the setup session, not a login, carries the token) and the unlock is what opens that session, so none of
 * them has one to be checked against; the hook skips them by name and they need no flag. The status is a `GET`, which is
 * never checked.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const SETUP_ROUTES: readonly string[] = [
  'GET /api/setup/status',
  'POST /api/setup/unlock',
  'POST /api/setup/manifest',
  'POST /api/setup/convert',
];

/** The two lists, as a parameter so a test can try a list that is not empty. */
interface CsrfSets {
  readonly exempt: readonly string[];
  readonly setup: readonly string[];
}

const DEFAULT_SETS: CsrfSets = { exempt: CSRF_EXEMPT, setup: SETUP_ROUTES };

const routeConfig = z.object({ csrf: z.literal('exempt').optional() });

/**
 * What is wrong with the CSRF declaration of a route, or `undefined` when nothing is: a route may set
 * `config.csrf = 'exempt'` only when every method it answers is on the exempt list with this very path. `config` is
 * `unknown` on purpose: a value that slipped past the types (`csrf: 'skip'`) is caught here.
 */
export function csrfProblem(
  methods: string | readonly string[],
  url: string,
  config: unknown,
  sets: CsrfSets = DEFAULT_SETS,
): string | undefined {
  const declared = routeConfig.safeParse(config ?? {});
  if (!declared.success) {
    return `route ${url} declares a config.csrf that is not 'exempt'`;
  }
  if (declared.data.csrf === undefined) {
    return undefined;
  }
  const outside = [methods].flat().find((method) => !sets.exempt.includes(`${method.toUpperCase()} ${url}`));
  return outside === undefined
    ? undefined
    : `route ${outside.toUpperCase()} ${url} sets config.csrf = 'exempt' but is not in CSRF_EXEMPT`;
}

/**
 * Whether the check is skipped for a request: the route is a setup route, or it is flagged and on the exempt list. A flag
 * on a route that is not on the list does not skip anything (registration refuses it, and this stays shut if it did not).
 */
export function skipsCsrfCheck(method: string, url: string, config: unknown, sets: CsrfSets = DEFAULT_SETS): boolean {
  const name = `${method} ${url}`;
  const flagged = routeConfig.safeParse(config).data?.csrf === 'exempt';
  return sets.setup.includes(name) || (flagged && sets.exempt.includes(name));
}
