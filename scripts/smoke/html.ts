// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// E19-S08: what the smoke test reads out of the page the container serves at `/`. Two questions only: is any script written
// into the page itself (the content security policy forbids it, so one would not run), and which files of `/assets/` does it load.

const SCRIPT_TAG = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const SRC_ATTRIBUTE = /\bsrc\s*=/i;
const HANDLER_ATTRIBUTE = /\s(on[a-z]+)\s*=/gi;
const REFERENCE = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
const ASSETS = '/assets/';

/** The `<script>` elements that carry code in the page: no `src`, or a body. A plain `<script src>` with nothing inside is not one. */
export function inlineScripts(html: string): string[] {
  return [...html.matchAll(SCRIPT_TAG)]
    .filter(([, attributes = '', body = '']) => !SRC_ATTRIBUTE.test(attributes) || body.trim() !== '')
    .map(([tag = '']) => tag);
}

/** The event handler attributes (`onclick=`, `onload=`) written into the page: code the policy would not run either. */
export function inlineHandlers(html: string): string[] {
  return [...html.matchAll(HANDLER_ATTRIBUTE)].map(([, name = '']) => name.toLowerCase());
}

/** The paths under `/assets/` that the page loads through `src` or `href`, without a query or a fragment, each once. */
export function assetPaths(html: string): string[] {
  const references = [...html.matchAll(REFERENCE)].map(([, reference = '']) => reference.split(/[?#]/, 1).join(''));
  return [
    ...new Set(references.filter((reference) => reference.startsWith(ASSETS) && reference.length > ASSETS.length)),
  ];
}
