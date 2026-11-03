// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyHelmetOptions } from '@fastify/helmet';
import type { AppConfig } from '../../config/env.ts';

/** Where GitHub serves the avatars the app shows (E17-S03); the one origin besides our own that a page may load from. */
const GITHUB_AVATARS = 'https://avatars.githubusercontent.com';

/** Where the setup page posts the App manifest (E19-S07): GitHub's page for creating an App; the one origin besides our own a form may post to. */
const GITHUB_FORMS = 'https://github.com';

/**
 * The directives of the policy. `formAction` is the one that differs: this origin only, except on the two pages of the
 * first-run setup, which post the App manifest to GitHub (see {@link setupPagePolicy}).
 */
function policyDirectives(config: Pick<AppConfig, 'publicBaseUrl'>, formAction: readonly string[]) {
  const https = config.publicBaseUrl.startsWith('https://');
  return {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'"],
    'img-src': ["'self'", GITHUB_AVATARS],
    'base-uri': ["'self'"],
    'form-action': formAction,
    'frame-ancestors': ["'none'"],
    'object-src': ["'none'"],
    ...(https ? { 'upgrade-insecure-requests': [] } : {}),
  };
}

/**
 * Strict by default: everything from this origin only, no inline script or style, no framing, no plugins, forms post
 * back to this origin. The SPA is served from the same origin, so nothing needs more, except that images may also come
 * from GitHub's avatar host (E17-S03): no `data:`, no `blob:`, no other origin. Fonts are the system's (no `font-src`). HSTS and
 * upgrade-insecure-requests are only sent for an https public URL: on plain http (local development) they would only
 * break the page.
 */
export function securityHeaders(config: Pick<AppConfig, 'publicBaseUrl'>): FastifyHelmetOptions {
  const https = config.publicBaseUrl.startsWith('https://');
  return {
    contentSecurityPolicy: { useDefaults: false, directives: policyDirectives(config, ["'self'"]) },
    frameguard: { action: 'deny' },
    strictTransportSecurity: https ? { maxAge: 63_072_000, includeSubDomains: true } : false,
  };
}

/**
 * The policy of the two pages of the first-run setup, as the header value (E19-S07): the default policy, with one more
 * origin in `form-action`, https://github.com, because the setup page posts the App manifest to GitHub with a real form and
 * the browser enforces `form-action` on a redirect too. Only the setup pages get it and only in setup mode; every other
 * response keeps `form-action 'self'`. It is written the way helmet writes the header, so the two differ in that directive only.
 */
export function setupPagePolicy(config: Pick<AppConfig, 'publicBaseUrl'>): string {
  return Object.entries(policyDirectives(config, ["'self'", GITHUB_FORMS]))
    .map(([name, values]) => (values.length === 0 ? name : `${name} ${values.join(' ')}`))
    .join(';');
}
