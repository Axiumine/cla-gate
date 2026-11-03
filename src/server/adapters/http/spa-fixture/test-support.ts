// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { onTestFinished } from 'vitest';
import { type TestApp, testApp } from '../../../test-support.ts';
import { unreachableDatabase } from '../test-support.ts';

// A built single-page app on disk for the tests of E17-S03: what `yarn build` leaves in dist/web, in miniature, and a
// file outside it that no request may reach.

/** What `index.html` of the fixture says, and the marker the tests look for in a response. */
export const INDEX_MARKER = 'fixture-index-8c1f';
export const INDEX_HTML = `<!doctype html><html lang="en"><head><title>${INDEX_MARKER}</title></head><body><div id="root"></div><script type="module" src="/assets/app-3f9a1c.js"></script></body></html>`;
export const SCRIPT_URL = '/assets/app-3f9a1c.js';
export const SCRIPT_TEXT = 'export const fixtureScript = true;';
/** The text of the file that is outside the web root, next to it. */
export const OUTSIDE_MARKER = 'outside-the-web-root-5d2e';

const FILES: Readonly<Record<string, string>> = {
  'index.html': INDEX_HTML,
  'assets/app-3f9a1c.js': SCRIPT_TEXT,
  'assets/app-3f9a1c.css': 'body{margin:0}',
  'assets/nested/chunk-77aa.js': 'export {};',
  'robots.txt': 'User-agent: *',
  // The blocking script of <head> that sets the theme (E17-S05): a root file, not a hashed asset.
  'theme-init.js': "document.documentElement.setAttribute('data-theme','light');",
  'favicon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
  '.hidden': 'dotfile-marker',
  '.git/config': 'dotdirectory-marker',
  'locales/en.json': '{}',
};

export interface WebFixture {
  /** The directory to serve: `WEB_ROOT`. */
  readonly root: string;
  /** The directory that holds it and `package.json`, a file outside the root. */
  readonly parent: string;
}

function put(directory: string, name: string, text: string): void {
  const file = path.join(directory, name);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: inside a directory created by mkdtemp
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: inside a directory created by mkdtemp
  fs.writeFileSync(file, text, 'utf8');
}

/** The fixture in a fresh temporary directory, removed after the current test: `files` (name to text) is what the root holds, the standard files by default. */
export function webFixture(files: Readonly<Record<string, string>> = FILES): WebFixture {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'cla-web-'));
  onTestFinished(() => {
    fs.rmSync(parent, { recursive: true, force: true });
  });
  const root = path.join(parent, 'web');
  put(parent, 'package.json', OUTSIDE_MARKER);
  for (const [name, text] of Object.entries(files)) {
    put(root, name, text);
  }
  return { root, parent };
}

/**
 * The real app with `NODE_ENV=test`, serving the standard fixture (or `env.WEB_ROOT`), on a database that is never reached:
 * serving the app touches none, and a request that did would fail with a refused connection.
 */
export async function webApp(
  env: Readonly<Record<string, string>> = {},
): Promise<TestApp & { readonly fixture: WebFixture }> {
  const fixture = webFixture();
  const started = await testApp({
    env: { NODE_ENV: 'test', WEB_ROOT: fixture.root, ...env },
    db: unreachableDatabase(),
  });
  return { ...started, fixture };
}
