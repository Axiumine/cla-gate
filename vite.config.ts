// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import process from 'node:process';
import react from '@vitejs/plugin-react';
import { defineConfig, type ProxyOptions } from 'vite';
import { LOOPBACK } from './scripts/ci/lib/ports.ts';

// The single-page app in src/web (E17-S01): `yarn build` writes dist/web, which the server serves from its own origin
// (E17-S03), and `yarn dev` runs the Vite dev server in front of the Fastify dev server (scripts/dev/dev.ts).
// No Babel and no React Compiler: @vitejs/plugin-react 6 transforms with Oxc, and the compiler is off in v0.

const ROOT = import.meta.dirname;

/** The paths of the API: the dev server forwards these to the app and serves everything else itself. */
const PROXIED_PATHS = ['/api', '/healthz', '/readyz'];

/**
 * Forwards the API to the Fastify dev server on the loopback port `PORT` names, which `yarn dev` picked (a random free port
 * above 32768, never 3000); scripts/dev/dev.ts refuses to start Vite without one. The browser's Origin header goes through
 * untouched, and `yarn dev` sets PUBLIC_BASE_URL to the Vite origin so that the app accepts it. Without PORT (Knip and other
 * tools load this file too) there is nothing to forward to, and a PORT that is not a number is a mistake worth a stop.
 */
function apiProxy(env: Readonly<Record<string, string | undefined>>): Record<string, ProxyOptions> {
  const port = env['PORT'] ?? '';
  if (port === '') {
    return {};
  }
  if (!/^\d+$/.test(port)) {
    throw new Error(`PORT must be the port of the Fastify dev server, not ${JSON.stringify(port)}`);
  }
  const target = `http://${LOOPBACK}:${port}`;
  return Object.fromEntries(PROXIED_PATHS.map((prefix) => [prefix, { target }]));
}

export default defineConfig(({ command }) => ({
  root: path.join(ROOT, 'src/web'),
  plugins: [react()],
  build: {
    outDir: path.join(ROOT, 'dist/web'),
    // The output directory is outside the root (src/web), so Vite must be told it may empty it.
    emptyOutDir: true,
    // No data: URI: the Content-Security-Policy forbids them, so every asset is a file.
    assetsInlineLimit: 0,
  },
  server: {
    host: LOOPBACK,
    ...(command === 'serve' ? { proxy: apiProxy(process.env) } : {}),
  },
}));
