// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { assetPaths, inlineHandlers, inlineScripts } from './html.ts';

// E19-S08: what the smoke test asks of the page at `/`.

const BUILT =
  '<!doctype html><html><head><link rel="stylesheet" crossorigin href="/assets/index-Ab12Cd34.css">' +
  '<script type="module" crossorigin src="/assets/index-Ef56Gh78.js"></script></head><body><div id="root"></div></body></html>';

test('the page Vite builds has no script in it, only scripts with a source', () => {
  expect(inlineScripts(BUILT)).toEqual([]);
  expect(inlineHandlers(BUILT)).toEqual([]);
});

test.each([
  ['a script with a body', '<script>window.x = 1</script>'],
  ['a script of a type', '<script type="module">import "/x.js"</script>'],
  ['a script with a source and a body', '<script src="/a.js">alert(1)</script>'],
  ['an empty script without a source', '<script></script>'],
  ['an upper-case tag', '<SCRIPT>alert(1)</SCRIPT >'],
])('%s is an inline script', (_label, tag) => {
  expect(inlineScripts(`<body>${tag}</body>`)).toEqual([tag]);
});

test('a script with a source and nothing inside is not an inline script, whatever the case of the attribute', () => {
  expect(inlineScripts('<script SRC="/a.js"></script><script src = "/b.js">  </script>')).toEqual([]);
});

test('event handler attributes are found by name', () => {
  expect(inlineHandlers('<body onload="x()"><a href="#" ONCLICK=\'y()\'>z</a></body>')).toEqual(['onload', 'onclick']);
});

test('a word that only contains on is not a handler', () => {
  expect(inlineHandlers('<a data-reason="x" title="onclick=">z</a>')).toEqual([]);
});

test('the assets are the paths under /assets/ loaded by src or href, each once, without query or fragment', () => {
  const html =
    '<link href="/assets/a.css?v=1"><script src="/assets/b.js#x"></script><img src="/assets/b.js"><a href="/assets/a.css">';
  expect(assetPaths(html)).toEqual(['/assets/a.css', '/assets/b.js']);
});

test('addresses on other origins and other directories, and the directory itself, are not assets of the page', () => {
  expect(assetPaths('<script src="https://cdn.example/assets/x.js"></script><img src="/img/x.png">')).toEqual([]);
  expect(assetPaths('<a href="/assets/"></a><a href="/assets/?x=1"></a>')).toEqual([]);
});
