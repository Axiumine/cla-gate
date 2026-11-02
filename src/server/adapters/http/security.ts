// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyHelmetOptions } from '@fastify/helmet';
import type { AppConfig } from '../../config/env.ts';

/** Where GitHub serves the avatars the app shows (E17-S03); the one origin besides our own that a page may load from. */
const GITHUB_AVATARS = 'https://avatars.githubusercontent.com';

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
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'img-src': ["'self'", GITHUB_AVATARS],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
        'object-src': ["'none'"],
        ...(https ? { 'upgrade-insecure-requests': [] } : {}),
      },
    },
    frameguard: { action: 'deny' },
    strictTransportSecurity: https ? { maxAge: 63_072_000, includeSubDomains: true } : false,
  };
}
