// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { type DefaultTreeAdapterMap, parse } from 'parse5';
import { build } from 'vite';
import { afterAll, expect, test, vi } from 'vitest';

// E17-S03: the page the server sends has to run under a Content-Security-Policy without 'unsafe-inline' and with no
// origin but our own (script-src, style-src and font-src fall back to default-src 'self'). This runs Vite's JavaScript
// build API with the real vite.config.ts into a temporary directory and checks what it wrote.

const ROOT = path.resolve(import.meta.dirname, '../..');
const BUILD_TIMEOUT_MS = 120_000;
/** The origin the built page is judged from: any URL of the page must resolve to it. */
const SITE = 'https://app.example';

// ------------------------------------------------------------------------------------------------ the checks

type HtmlNode = DefaultTreeAdapterMap['node'];
type HtmlElement = DefaultTreeAdapterMap['element'];

function isElement(node: HtmlNode): node is HtmlElement {
  return 'tagName' in node;
}

/** Every element of the page, in document order, as the HTML parser of a browser builds them. */
function elementsOf(node: HtmlNode): HtmlElement[] {
  const children = 'childNodes' in node ? node.childNodes : [];
  return children.flatMap((child) => (isElement(child) ? [child, ...elementsOf(child)] : elementsOf(child)));
}

/** The text an element holds directly (the body of a script). */
function textOf(element: HtmlElement): string {
  return element.childNodes.map((child) => ('value' in child ? child.value : '')).join('');
}

function attributeNames(element: HtmlElement): string[] {
  return element.attrs.map((attribute) => attribute.name);
}

function attributeOf(element: HtmlElement, name: string): string {
  return element.attrs.find((attribute) => attribute.name === name)?.value ?? '';
}

/** Whether a URL, resolved against the site, stays on it and names no scheme of its own (`//host/x` and `data:` do not). */
function staysOnSite(url: string): boolean {
  return URL.canParse(url, SITE) && new URL(url, SITE).origin === SITE;
}

/** The URLs a page loads: the `src` of its scripts and the `href` of its links. */
function loadedUrls(elements: readonly HtmlElement[]): string[] {
  return elements.flatMap((element) => {
    if (element.tagName === 'script') {
      return [attributeOf(element, 'src')];
    }
    return element.tagName === 'link' ? [attributeOf(element, 'href')] : [];
  });
}

/** What the policy blocks, or what another origin could serve, in the HTML text `html`. */
function htmlProblems(html: string): string[] {
  const elements = elementsOf(parse(html));
  const scripts = elements.filter((element) => element.tagName === 'script');
  const checks: readonly (readonly [string, boolean])[] = [
    ['an inline script', scripts.some((script) => textOf(script).trim() !== '')],
    ['a script without src', scripts.some((script) => attributeOf(script, 'src') === '')],
    ['an inline <style>', elements.some((element) => element.tagName === 'style')],
    ['a style attribute', elements.some((element) => attributeNames(element).includes('style'))],
    ['an on* attribute', elements.some((element) => attributeNames(element).some((name) => name.startsWith('on')))],
    ['a URL that is not same-origin and relative', loadedUrls(elements).some((url) => !staysOnSite(url))],
  ];
  return checks.filter(([, found]) => found).map(([problem]) => problem);
}

/** Each argument of a `url(...)` in a CSS text, without quotes. */
function urlArguments(css: string): string[] {
  return css
    .split(/url\(/i)
    .slice(1)
    .map((rest) =>
      rest
        .slice(0, Math.max(rest.indexOf(')'), 0))
        .trim()
        .replace(/^["']|["']$/g, ''),
    );
}

/** The string of each `@import "..."` of a CSS text; `@import url(...)` is read by {@link urlArguments}. */
function importedStrings(css: string): string[] {
  return css
    .split(/@import/i)
    .slice(1)
    .flatMap((rest) => /^\s*["']([^"']*)["']/.exec(rest)?.[1] ?? []);
}

/** What a CSS text loads that the policy blocks or that is not ours: a `data:` URI, another origin, a web font. */
function cssProblems(css: string): string[] {
  const references = [...urlArguments(css), ...importedStrings(css)];
  const checks: readonly (readonly [string, boolean])[] = [
    ['a data: URI', urlArguments(css).some((url) => /^data:/i.test(url))],
    ['a reference to another origin', references.some((url) => !staysOnSite(url))],
    ['a web font', /@font-face/i.test(css)],
  ];
  return checks.filter(([, found]) => found).map(([problem]) => problem);
}

// ------------------------------------------------------------------------------------------ the real build

interface Built {
  readonly directory: string;
  readonly html: string;
  /** Every emitted file, relative to the output directory with `/` separators. */
  readonly files: readonly string[];
  /** The text of every emitted stylesheet. */
  readonly styles: readonly string[];
}

/** A file of the build, from the directory made by mkdtemp. */
function readText(directory: string, name: string): Promise<string> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test: a file that the build wrote into a directory made by mkdtemp
  return fs.readFile(path.join(directory, name), 'utf8');
}

async function runBuild(): Promise<Built> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cla-web-build-'));
  // Vite builds the production bundle under NODE_ENV=production; Vitest sets it to `test`.
  vi.stubEnv('NODE_ENV', 'production');
  try {
    await build({ configFile: path.join(ROOT, 'vite.config.ts'), logLevel: 'silent', build: { outDir: directory } });
  } finally {
    vi.unstubAllEnvs();
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test: the directory made by mkdtemp above
  const files = (await fs.readdir(directory, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'));
  const styles = await Promise.all(
    files.filter((file) => file.endsWith('.css')).map((file) => readText(directory, file)),
  );
  return { directory, html: await readText(directory, 'index.html'), files, styles };
}

let started: Promise<Built> | undefined;
function theBuild(): Promise<Built> {
  started ??= runBuild();
  return started;
}

afterAll(async () => {
  const directory = (await started?.catch(() => undefined))?.directory;
  if (directory !== undefined) {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test(
  'index.html has no inline script, no inline style, no style attribute, no handler and only URLs of our origin',
  async () => {
    const { html } = await theBuild();
    expect(htmlProblems(html)).toEqual([]);
  },
  BUILD_TIMEOUT_MS,
);

test(
  'index.html loads the app by one module script and one stylesheet, both hashed files under /assets/',
  async () => {
    const { html } = await theBuild();
    const loaders = elementsOf(parse(html)).filter((element) => ['script', 'link'].includes(element.tagName));
    expect(
      loaders.map((element) => [element.tagName, attributeOf(element, 'type') || attributeOf(element, 'rel')]),
    ).toEqual([
      ['script', 'module'],
      ['link', 'stylesheet'],
    ]);
    for (const url of loadedUrls(loaders)) {
      expect(url).toMatch(/^\/assets\/[\w-]+-[\w-]{8}\.(js|css)$/);
    }
  },
  BUILD_TIMEOUT_MS,
);

test(
  'every file of the build but index.html is under assets/, whose names carry a hash, and nothing is a font or a data: asset',
  async () => {
    const { files } = await theBuild();
    expect(files).toContain('index.html');
    const others = files.filter((file) => file !== 'index.html');
    expect(others.length).toBeGreaterThan(0);
    for (const file of others) {
      expect(file).toMatch(/^assets\/[\w-]+-[\w-]{8}\.(js|css)$/);
    }
  },
  BUILD_TIMEOUT_MS,
);

test(
  'no emitted CSS has a data: URI, a reference to another origin or a web font, and the font is the system stack',
  async () => {
    const { styles } = await theBuild();
    expect(styles.length).toBeGreaterThan(0);
    for (const css of styles) {
      expect(cssProblems(css)).toEqual([]);
    }
    expect(styles.join('\n')).toMatch(/font-family:\s*var\(--font-sans\)/);
    expect(styles.join('\n')).toMatch(/--font-sans:\s*system-ui/);
  },
  BUILD_TIMEOUT_MS,
);

// ------------------------------------------------------------------------------------------- the checks catch

const GOOD_PAGE =
  '<!doctype html><html lang="en"><head><link rel="stylesheet" href="/assets/a-12345678.css"></head>' +
  '<body><div id="root"></div><script type="module" crossorigin src="/assets/a-12345678.js"></script></body></html>';

test('the page checks accept a good page', () => {
  expect(htmlProblems(GOOD_PAGE)).toEqual([]);
});

test.each([
  ['an inline script', GOOD_PAGE.replace('</body>', '<script>run()</script></body>'), 'an inline script'],
  [
    'a script without src',
    GOOD_PAGE.replace('</body>', '<script type="module"></script></body>'),
    'a script without src',
  ],
  ['an inline style', GOOD_PAGE.replace('<body>', '<style>b{}</style><body>'), 'an inline <style>'],
  ['a style attribute', GOOD_PAGE.replace('id="root"', "id='root' style=color:red"), 'a style attribute'],
  ['a handler', GOOD_PAGE.replace('<body>', '<body ONLOAD="x()">'), 'an on* attribute'],
  [
    'a script of another origin',
    GOOD_PAGE.replace('/assets/a-12345678.js', 'https://cdn.example/a.js'),
    'a URL that is not same-origin and relative',
  ],
  [
    'a protocol-relative script',
    GOOD_PAGE.replace('/assets/a-12345678.js', '//cdn.example/a.js'),
    'a URL that is not same-origin and relative',
  ],
  [
    'a stylesheet of another origin',
    GOOD_PAGE.replace('/assets/a-12345678.css', 'http://fonts.example/a.css'),
    'a URL that is not same-origin and relative',
  ],
  [
    'a data: link',
    GOOD_PAGE.replace('/assets/a-12345678.css', 'data:text/css,b{}'),
    'a URL that is not same-origin and relative',
  ],
  [
    'a URL that cannot be parsed',
    GOOD_PAGE.replace('/assets/a-12345678.css', 'http://'),
    'a URL that is not same-origin and relative',
  ],
])('the page checks catch %s', (_what, html, problem) => {
  expect(htmlProblems(html)).toContain(problem);
});

test.each([
  ['a relative url()', 'a{background:url(/assets/a-12345678.svg)}'],
  ['a quoted relative url()', 'a{background:url( "./a.svg" )}'],
  ['a system font stack', ':root{--f:system-ui,"Segoe UI",sans-serif}b{font-family:var(--f)}'],
])('the CSS checks accept %s', (_what, css) => {
  expect(cssProblems(css)).toEqual([]);
});

test.each([
  ['a data: URI', 'a{background:url(data:image/png;base64,AAAA)}', 'a data: URI'],
  ['a quoted data: URI', "a{background:url( 'data:image/svg+xml,<svg/>' )}", 'a data: URI'],
  ['a URL of another origin', 'a{background:url(https://cdn.example/a.png)}', 'a reference to another origin'],
  ['a protocol-relative URL', 'a{background:url("//cdn.example/a.png")}', 'a reference to another origin'],
  [
    'an import of another origin',
    '@import url("https://fonts.example/css?family=Inter");a{}',
    'a reference to another origin',
  ],
  ['a bare import of another origin', '@import "https://fonts.example/a.css";a{}', 'a reference to another origin'],
  ['a web font', "@font-face{font-family:X;src:url('/assets/x-12345678.woff2')}", 'a web font'],
])('the CSS checks catch %s', (_what, css, problem) => {
  expect(cssProblems(css)).toContain(problem);
});
