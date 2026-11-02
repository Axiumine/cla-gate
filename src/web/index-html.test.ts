// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import source from './index.html?raw';

// E17-S01: the page the server sends has to run under a Content-Security-Policy without 'unsafe-inline'
// (script-src 'self', style-src 'self'), so its markup holds nothing the policy would block.

type Check = readonly [problem: string, found: (page: Document) => boolean];

const scriptsOf = (page: Document): HTMLScriptElement[] => [...page.querySelectorAll('script')];
const attributesOf = (page: Document): string[] =>
  [...page.querySelectorAll('*')].flatMap((e) => e.getAttributeNames());

/** Each check is a problem and the test that finds it. */
const CHECKS: readonly Check[] = [
  ['not exactly one script', (page) => scriptsOf(page).length !== 1],
  ['a script that is not type="module"', (page) => scriptsOf(page).some((s) => s.getAttribute('type') !== 'module')],
  ['a script without src', (page) => scriptsOf(page).some((s) => (s.getAttribute('src') ?? '') === '')],
  ['an inline script', (page) => scriptsOf(page).some((s) => s.textContent !== '')],
  ['an inline <style>', (page) => page.querySelector('style') !== null],
  ['a style attribute', (page) => attributesOf(page).includes('style')],
  ['an on* event handler attribute', (page) => attributesOf(page).some((name) => name.startsWith('on'))],
  ['no <html lang="en">', (page) => page.documentElement.getAttribute('lang') !== 'en'],
  ['no viewport meta tag', (page) => page.querySelector('meta[name="viewport"][content]') === null],
  ['no <title>', (page) => (page.querySelector('title')?.textContent ?? '').trim() === ''],
];

/** What the policy blocks, or the page needs and lacks, in the HTML text `html`. */
function problems(html: string): string[] {
  const page = new DOMParser().parseFromString(html, 'text/html');
  return CHECKS.filter(([, found]) => found(page)).map(([problem]) => problem);
}

const GOOD =
  '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><title>T</title></head>' +
  '<body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>';

test('index.html passes every check', () => {
  expect(problems(source)).toEqual([]);
});

test('index.html mounts the app where main.tsx looks for it', () => {
  const page = new DOMParser().parseFromString(source, 'text/html');
  expect(page.querySelector('body > div#root')?.childNodes).toHaveLength(0);
  expect(page.querySelector('script')?.getAttribute('src')).toBe('/main.tsx');
});

test('the checks accept a minimal good page', () => {
  expect(problems(GOOD)).toEqual([]);
});

test.each([
  ['a second, inline script', GOOD.replace('</body>', '<script>alert(1)</script></body>'), 'not exactly one script'],
  ['no script', GOOD.replace(/<script.*<\/script>/, ''), 'not exactly one script'],
  ['an inline script body', GOOD.replace('src="/main.tsx">', 'src="/main.tsx">run()'), 'an inline script'],
  ['a classic script', GOOD.replace('type="module" ', ''), 'a script that is not type="module"'],
  ['a script without src', GOOD.replace(' src="/main.tsx"', ''), 'a script without src'],
  ['an inline style', GOOD.replace('<title>', '<style>body{}</style><title>'), 'an inline <style>'],
  ['a style attribute', GOOD.replace('id="root"', 'id="root" style="color:red"'), 'a style attribute'],
  ['an event handler', GOOD.replace('<body>', '<body onload="start()">'), 'an on* event handler attribute'],
  ['another language', GOOD.replace('lang="en"', 'lang="it"'), 'no <html lang="en">'],
  ['no viewport', GOOD.replace('<meta name="viewport" content="width=device-width">', ''), 'no viewport meta tag'],
  ['an empty title', GOOD.replace('<title>T</title>', '<title> </title>'), 'no <title>'],
])('the checks catch %s', (_what, html, problem) => {
  expect(problems(html)).toContain(problem);
});
