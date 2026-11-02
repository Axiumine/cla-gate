// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';
import { webProject } from '../../vitest.projects.ts';
import { repoText } from '../semgrep-rules/test-support.ts';

// E17-S05: the packages, configuration and gates that put the stylesheet pipeline and the theme under the same rules as
// the rest of src/web.

const manifest = z
  .object({ dependencies: z.record(z.string(), z.string()), devDependencies: z.record(z.string(), z.string()) })
  .parse(JSON.parse(repoText('package.json')));

test('Tailwind CSS 4 and its Vite plugin are build tools of one exact, shared version, not runtime dependencies', () => {
  const { tailwindcss, '@tailwindcss/vite': plugin } = manifest.devDependencies;
  expect(tailwindcss).toMatch(/^4\.\d+\.\d+$/);
  expect(plugin).toBe(tailwindcss);
  expect(Object.keys(manifest.dependencies).filter((name) => name.includes('tailwind'))).toEqual([]);
});

test('postcss, which the tests of the stylesheets parse them with, is a development dependency', () => {
  expect(manifest.devDependencies['postcss']).toMatch(/^\^8\./);
  expect(Object.keys(manifest.dependencies)).not.toContain('postcss');
});

test('Dependabot bumps tailwindcss and @tailwindcss/vite together, before the catch-all group takes them', () => {
  const config = z
    .object({
      updates: z.array(
        z.looseObject({
          'package-ecosystem': z.string(),
          groups: z.record(z.string(), z.looseObject({ patterns: z.array(z.string()).optional() })).optional(),
        }),
      ),
    })
    .parse(parse(repoText('.github/dependabot.yml')));
  const groups = Object.entries(config.updates.find((update) => update['package-ecosystem'] === 'npm')?.groups ?? {});
  const tailwind = groups.findIndex(([, group]) => group.patterns?.includes('tailwindcss') === true);
  const catchAll = groups.findIndex(([, group]) => group.patterns?.includes('*') === true);
  expect(groups.at(tailwind)?.[1].patterns).toEqual(['tailwindcss', '@tailwindcss/*']);
  expect(tailwind).toBeGreaterThanOrEqual(0);
  expect(tailwind).toBeLessThan(catchAll);
});

test('Biome reads the Tailwind directives of app.css (@theme, @custom-variant, @source), so the sheet is linted and formatted', () => {
  const biome = z
    .object({ css: z.object({ parser: z.object({ tailwindDirectives: z.boolean() }) }) })
    .parse(JSON.parse(repoText('biome.json')));
  expect(biome.css.parser.tailwindDirectives).toBe(true);
});

test('Vitest lets a stylesheet through as text (?raw) for the token tests and keeps every other CSS import empty', () => {
  const include = webProject.test?.css;
  const patterns = typeof include === 'object' ? (include.include ?? []) : [];
  const matches = (id: string): boolean =>
    [patterns].flat().some((pattern) => pattern instanceof RegExp && pattern.test(id));
  expect(matches('/src/web/styles/tokens.css?raw')).toBe(true);
  expect(matches('/src/web/styles/tokens.css')).toBe(false);
  expect(matches('/src/web/styles/tokens.css?inline')).toBe(false);
});

test('Knip follows the stylesheet and the theme script: both are entries, and CSS is not a production file', () => {
  const knip = z
    .object({ entry: z.array(z.string()), project: z.array(z.string()) })
    .parse(JSON.parse(repoText('knip.json')));
  expect(knip.entry).toEqual(
    expect.arrayContaining(['src/web/theme/index.ts!', 'src/web/theme/theme-init.ts!', 'src/web/styles/app.css']),
  );
  expect(knip.project).toContain('src/**/*.css');
  expect(knip.project).not.toContain('src/**/*.css!');
});

test('the page links the stylesheet that imports Tailwind and the tokens, and the old typography sheet is gone', () => {
  expect(repoText('src/web/index.html')).toContain('href="/styles/app.css"');
  expect(repoText('src/web/index.html')).not.toContain('typography.css');
  expect(repoText('src/web/styles/app.css')).toContain('@import "./tokens.css"');
});
