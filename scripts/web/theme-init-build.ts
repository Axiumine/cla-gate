// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { build, type Plugin } from 'vite';

// The Vite plugin that builds src/web/theme/theme-init.ts into theme-init.js (E17-S05). index.html loads that file as a
// blocking classic script in <head>, so that `data-theme` is set before the first paint: a module script is deferred,
// and an inline script would need 'unsafe-inline' in the Content-Security-Policy. A classic script cannot import, and the
// app shares modules with it (the storage module, the theme model), so putting it in the app's own build as a second entry
// would make Rolldown move those modules into a shared chunk that the script imports. It is therefore bundled in a pass of
// its own, as one self-contained script, and emitted without a hash under the name index.html uses.

const ROOT = path.resolve(import.meta.dirname, '../..');
const ENTRY = path.join(ROOT, 'src/web/theme/theme-init.ts');

/** The file name in the output directory, and the path the dev server answers on. */
export const THEME_INIT_FILE = 'theme-init.js';

/** The code of the script, minified: the theme module, the storage module and their calls, and nothing else. */
export async function bundleThemeInit(run: typeof build = build): Promise<string> {
  const result = await run({
    configFile: false,
    root: ROOT,
    logLevel: 'silent',
    publicDir: false,
    build: {
      write: false,
      minify: true,
      lib: { entry: ENTRY, formats: ['iife'], name: 'claThemeInit', fileName: () => THEME_INIT_FILE },
    },
  });
  const bundle = [result].flat().find((candidate) => 'output' in candidate);
  if (bundle === undefined || !('output' in bundle)) {
    throw new Error('The build of the theme script produced no output');
  }
  return bundle.output[0].code;
}

/** `vite build` writes theme-init.js next to index.html; `yarn dev` answers the same path, so the page is the same in both. */
export function themeInit(run: typeof build = build): Plugin {
  return {
    name: 'cla:theme-init',
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: THEME_INIT_FILE, source: await bundleThemeInit(run) });
    },
    configureServer(server) {
      server.middlewares.use(`/${THEME_INIT_FILE}`, (_request, response, next) => {
        bundleThemeInit(run).then((code) => {
          response.setHeader('Content-Type', 'text/javascript');
          response.setHeader('Cache-Control', 'no-cache');
          response.end(code);
        }, next);
      });
    },
  };
}
