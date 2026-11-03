// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { securityHeaders } from './security.ts';

test('http: a strict policy without HSTS or upgrade-insecure-requests', () => {
  const options = securityHeaders({ publicBaseUrl: 'http://localhost:3000' });
  expect(options.strictTransportSecurity).toBe(false);
  expect(options.contentSecurityPolicy).toEqual({
    useDefaults: false,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'"],
      'img-src': ["'self'", 'https://avatars.githubusercontent.com'],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
      'object-src': ["'none'"],
    },
  });
  expect(options.frameguard).toEqual({ action: 'deny' });
});

test('https: HSTS for two years and upgrade-insecure-requests', () => {
  const options = securityHeaders({ publicBaseUrl: 'https://cla.example.org' });
  expect(options.strictTransportSecurity).toEqual({ maxAge: 63_072_000, includeSubDomains: true });
  expect(options.contentSecurityPolicy).toMatchObject({ directives: { 'upgrade-insecure-requests': [] } });
});
