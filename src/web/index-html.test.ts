// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import source from './index.html?raw';

// E17-S01: the page the server sends has to run under a Content-Security-Policy without 'unsafe-inline'
// (script-src 'self', style-src 'self'), so its markup holds nothing the policy would block. E17-S05 adds the one classic
// script (theme-init.js, blocking, in <head> before the stylesheet) and the colour-scheme meta tag.

type Check = readonly [problem: string, found: (page: Document) => boolean];

const scriptsOf = (page: Document): HTMLScriptElement[] => [...page.querySelectorAll('script')];
const modulesOf = (page: Document): HTMLScriptElement[] =>
  scriptsOf(page).filter((script) => script.getAttribute('type') === 'module');
const classicOf = (page: Document): HTMLScriptElement[] =>
  scriptsOf(page).filter((script) => script.getAttribute('type') !== 'module');
const attributesOf = (page: Document): string[] =>
  [...page.querySelectorAll('*')].flatMap((e) => e.getAttributeNames());

/** Whether the theme script is a plain blocking `<script src>` of <head> that comes before the stylesheet it would flash against. */
function themeScriptBlocks(page: Document): boolean {
  const [theme, ...others] = classicOf(page);
  const sheet = page.querySelector('link[rel="stylesheet"]');
  return (
    theme !== undefined &&
    others.length === 0 &&
    theme.parentElement === page.head &&
    ['async', 'defer', 'type', 'nomodule'].every((name) => !theme.hasAttribute(name)) &&
    (sheet === null || (theme.compareDocumentPosition(sheet) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)
  );
}

/** Each check is a problem and the test that finds it. */
const CHECKS: readonly Check[] = [
  ['not exactly two scripts', (page) => scriptsOf(page).length !== 2],
  ['not exactly one module script', (page) => modulesOf(page).length !== 1],
  ['no blocking theme script in <head> before the stylesheet', (page) => !themeScriptBlocks(page)],
  [
    'a theme script that is not /theme-init.js',
    (page) => classicOf(page).some((s) => s.getAttribute('src') !== '/theme-init.js'),
  ],
  ['a script without src', (page) => scriptsOf(page).some((s) => (s.getAttribute('src') ?? '') === '')],
  ['an inline script', (page) => scriptsOf(page).some((s) => s.textContent !== '')],
  ['an inline <style>', (page) => page.querySelector('style') !== null],
  ['a style attribute', (page) => attributesOf(page).includes('style')],
  ['an on* event handler attribute', (page) => attributesOf(page).some((name) => name.startsWith('on'))],
  ['no <html lang="en">', (page) => page.documentElement.getAttribute('lang') !== 'en'],
  ['no viewport meta tag', (page) => page.querySelector('meta[name="viewport"][content]') === null],
  [
    'no color-scheme meta tag for light and dark',
    (page) => page.querySelector('meta[name="color-scheme"][content="light dark"]') === null,
  ],
  ['no <title>', (page) => (page.querySelector('title')?.textContent ?? '').trim() === ''],
];

/** What the policy blocks, or the page needs and lacks, in the HTML text `html`. */
function problems(html: string): string[] {
  const page = new DOMParser().parseFromString(html, 'text/html');
  return CHECKS.filter(([, found]) => found(page)).map(([problem]) => problem);
}

const GOOD =
  '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width">' +
  '<meta name="color-scheme" content="light dark"><title>T</title><script src="/theme-init.js"></script>' +
  '<link rel="stylesheet" href="/styles/app.css"></head>' +
  '<body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>';

test('index.html passes every check', () => {
  expect(problems(source)).toEqual([]);
});

test('index.html mounts the app where main.tsx looks for it', () => {
  const page = new DOMParser().parseFromString(source, 'text/html');
  expect(page.querySelector('body > div#root')?.childNodes).toHaveLength(0);
  expect(page.querySelector('script[type="module"]')?.getAttribute('src')).toBe('/main.tsx');
});

test('index.html loads the theme script first and the stylesheet of the app, and says that both colour schemes are supported', () => {
  const page = new DOMParser().parseFromString(source, 'text/html');
  expect(
    [...page.head.children].map((e) => e.getAttribute('src') ?? e.getAttribute('href') ?? e.getAttribute('name')),
  ).toEqual(expect.arrayContaining(['/theme-init.js', '/styles/app.css', 'color-scheme']));
  expect(page.querySelector('meta[name="color-scheme"]')?.getAttribute('content')).toBe('light dark');
  expect(page.querySelector('link[rel="stylesheet"]')?.getAttribute('href')).toBe('/styles/app.css');
});

test('the checks accept a minimal good page', () => {
  expect(problems(GOOD)).toEqual([]);
});

test.each([
  ['a third, inline script', GOOD.replace('</body>', '<script>alert(1)</script></body>'), 'not exactly two scripts'],
  ['no module script', GOOD.replace(/<script type="module".*<\/script>/, ''), 'not exactly one module script'],
  [
    'no theme script',
    GOOD.replace('<script src="/theme-init.js"></script>', ''),
    'no blocking theme script in <head> before the stylesheet',
  ],
  [
    'a theme script after the stylesheet',
    GOOD.replace('<script src="/theme-init.js"></script>', '').replace(
      '</head>',
      '<script src="/theme-init.js"></script></head>',
    ),
    'no blocking theme script in <head> before the stylesheet',
  ],
  [
    'a theme script outside <head>',
    GOOD.replace('<script src="/theme-init.js"></script>', '').replace(
      '<div id="root">',
      '<script src="/theme-init.js"></script><div id="root">',
    ),
    'no blocking theme script in <head> before the stylesheet',
  ],
  [
    'a deferred theme script',
    GOOD.replace('<script src="/theme-init.js">', '<script defer src="/theme-init.js">'),
    'no blocking theme script in <head> before the stylesheet',
  ],
  [
    'a theme script that is not the built one',
    GOOD.replace('"/theme-init.js"', '"/other.js"'),
    'a theme script that is not /theme-init.js',
  ],
  ['an inline script body', GOOD.replace('src="/main.tsx">', 'src="/main.tsx">run()'), 'an inline script'],
  ['a script without src', GOOD.replace(' src="/main.tsx"', ''), 'a script without src'],
  ['an inline style', GOOD.replace('<title>', '<style>body{}</style><title>'), 'an inline <style>'],
  ['a style attribute', GOOD.replace('id="root"', 'id="root" style="color:red"'), 'a style attribute'],
  ['an event handler', GOOD.replace('<body>', '<body onload="start()">'), 'an on* event handler attribute'],
  ['another language', GOOD.replace('lang="en"', 'lang="it"'), 'no <html lang="en">'],
  ['no viewport', GOOD.replace('<meta name="viewport" content="width=device-width">', ''), 'no viewport meta tag'],
  [
    'a colour-scheme meta tag for light only',
    GOOD.replace('content="light dark"', 'content="light"'),
    'no color-scheme meta tag for light and dark',
  ],
  ['an empty title', GOOD.replace('<title>T</title>', '<title> </title>'), 'no <title>'],
])('the checks catch %s', (_what, html, problem) => {
  expect(problems(html)).toContain(problem);
});
