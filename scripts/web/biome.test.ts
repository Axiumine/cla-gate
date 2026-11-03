// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { readText } from '../ci/lib/test-support.ts';
import { makeRepo, tempDir } from '../code-caps/test-support.ts';

// E17-S01: the Biome rules of src/web, judged by Biome's own CLI on violating source text in a temporary directory that
// holds the repository's real biome.json (less its git integration, which a directory outside a repository cannot use).
// No violating file exists in the repository, and nothing is excluded from a gate.

const ROOT = path.resolve(import.meta.dirname, '../..');
const BIOME = path.join(ROOT, 'node_modules/.bin/biome');

const repositoryConfig = z.record(z.string(), z.unknown()).parse(JSON.parse(readText(path.join(ROOT, 'biome.json'))));
const config = Object.fromEntries(
  Object.entries(repositoryConfig).filter(([key]) => key !== 'vcs' && key !== '$schema'),
);

/** What `biome ci --error-on-warnings` makes of a directory that holds `source` as the file `file`. */
function biome(file: string, source: string): { status: number | null; output: string } {
  const directory = tempDir();
  makeRepo(directory, { 'biome.json': JSON.stringify(config), [file]: source });
  const result = spawnSync(BIOME, ['ci', '--error-on-warnings', '--colors=off', file], {
    cwd: directory,
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const WEB_OVERRIDE = z
  .object({ overrides: z.array(z.object({ includes: z.array(z.string()), linter: z.unknown().optional() })) })
  .parse(repositoryConfig)
  .overrides.find((override) => override.includes.includes('src/web/**'));

const CLEAN = 'export function Page() {\n  return <img alt="A cat" src="/cat.png" />;\n}\n';

test('the web override sets the React rules, the whole a11y group and the innerHTML rule', () => {
  expect(WEB_OVERRIDE?.linter).toEqual({
    domains: { react: 'recommended' },
    rules: { a11y: 'error', security: { noDangerouslySetInnerHtml: 'error' } },
  });
});

test('the React rules are for src/web only: a plain function named use... elsewhere is not a hook', () => {
  const source =
    'const useToken = (id: number) => id;\nexport function read(id: number) {\n  return useToken(id);\n}\n';
  expect(biome('src/server/token.ts', source).status).toBe(0);
  expect(biome('src/web/token.ts', source).output).toContain('lint/correctness/useHookAtTopLevel');
});

test('a clean component passes, so the failures below are the rules and nothing else', () => {
  const { status, output } = biome('src/web/Page.tsx', CLEAN);
  expect(output).toContain('Checked 1 file');
  expect(status).toBe(0);
});

test.each([
  ['an image without alt text', '<img src="/cat.png" />', 'lint/a11y/useAltText'],
  ['a click handler on a div', '<div onClick={() => undefined} />', 'lint/a11y/noStaticElementInteractions'],
  ['a button without a type', '<button>Save</button>', 'lint/a11y/useButtonType'],
  [
    'dangerouslySetInnerHTML',
    '<p dangerouslySetInnerHTML={{ __html: text }} />',
    'lint/security/noDangerouslySetInnerHtml',
  ],
])('src/web fails on %s', (_what, element, rule) => {
  const source = `export function Page({ text }: { text: string }) {\n  return <main>{text}${element}</main>;\n}\n`;
  const { status, output } = biome('src/web/Page.tsx', source);
  expect(output).toContain(rule);
  expect(status).toBe(1);
});

// E17-S11: no `dangerouslySetInnerHTML` anywhere in src/web. The rule reads JSX and createElement calls alike, in a component, a
// plain module and a test, so the one door for user text (UserText) cannot be bypassed by a file that Biome skips. The spread
// form, which Biome does not follow, is caught by ESLint (scripts/web/eslint-config.test.ts).
test.each([
  ['a component', 'src/web/Page.tsx', '<p dangerouslySetInnerHTML={{ __html: text }} />'],
  ['a test of a component', 'src/web/ui/Page.test.tsx', '<p dangerouslySetInnerHTML={{ __html: text }} />'],
  ['a createElement call', 'src/web/ui/page.ts', "createElement('p', { dangerouslySetInnerHTML: { __html: text } })"],
])('the innerHTML rule fires on %s', (_what, file, expression) => {
  const source = `import { createElement } from 'react';\nexport function page(text: string) {\n  return ${expression};\n}\n`;
  const { status, output } = biome(file, source);
  expect(output).toContain('lint/security/noDangerouslySetInnerHtml');
  expect(status).toBe(1);
});
