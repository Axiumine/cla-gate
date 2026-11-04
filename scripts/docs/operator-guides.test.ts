// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from 'vitest';
import { exists, findOnPath, readText } from '../ci/lib/test-support.ts';
import {
  codeBlocks,
  GUIDES,
  guide,
  guidePath,
  headingsOf,
  linksOf,
  proseOf,
  slugOf,
  tablesOf,
} from './test-support.ts';

// The eight operator guides of docs/operations/ (E19-S09): that they exist, that every link inside them leads somewhere that
// exists, and the few house rules of the documents (table separators, no emoji, one level-one title). What each guide says is
// asserted by the neighbouring files, against the code and the stack it describes.

test.each(GUIDES)('docs/operations/%s.md exists and opens with exactly one level-one title', (name) => {
  expect(exists(guidePath(name))).toBe(true);
  const titles = proseOf(guide(name))
    .split('\n')
    .filter((line) => line.startsWith('# '));
  expect(titles).toHaveLength(1);
  expect(guide(name).startsWith(titles[0] ?? '?')).toBe(true);
});

/** The links of a guide that point at a file of the repository (not at a web address), as `[target, file, anchor]`. */
function localLinks(name: string): [string, string, string][] {
  return linksOf(guide(name))
    .filter((target) => !/^[a-z]+:/.test(target))
    .map((target): [string, string, string] => {
      const [file = '', anchor = ''] = target.split('#');
      return [target, file === '' ? guidePath(name) : path.resolve(path.dirname(guidePath(name)), file), anchor];
    });
}

test.each(GUIDES)('every link of %s.md leads to a file that exists', (name) => {
  const missing = localLinks(name)
    .filter(([, file]) => !exists(file))
    .map(([target]) => target);
  expect(missing).toEqual([]);
});

test.each(GUIDES)('every anchor that %s.md links to is a heading of the page it names', (name) => {
  const broken = localLinks(name)
    .filter(([, file, anchor]) => anchor !== '' && exists(file))
    .filter(([, file, anchor]) => !headingsOf(readText(file)).map(slugOf).includes(anchor))
    .map(([target]) => target);
  expect(broken).toEqual([]);
});

test.each(GUIDES)('the tables of %s.md use |---| separators and every row has as many cells as the header', (name) => {
  for (const table of tablesOf(guide(name))) {
    const columns = table.separator.split('|').length - 2;
    expect(table.separator).toBe(`|${'---|'.repeat(columns)}`);
    expect(table.rows.map((cells) => cells.length)).toEqual(table.rows.map(() => columns));
  }
});

test.each(GUIDES)('%s.md has no emoji and never uses the word the project avoids', (name) => {
  const text = guide(name);
  expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  expect(text.toLowerCase()).not.toContain('multi-installation');
});

test('the install guide links to the seven other guides, so a reader finds them from the first page', () => {
  const targets = new Set(linksOf(guide('install')).map((target) => target.split('#')[0]));
  const others = GUIDES.filter((name) => name !== 'install').map((name) => `${name}.md`);
  expect(others.filter((file) => !targets.has(file))).toEqual([]);
});

test.each(GUIDES)('%s.md links inside itself with a bare #anchor and never by its own file name', (name) => {
  expect(linksOf(guide(name)).map((target) => target.split('#')[0])).not.toContain(`${name}.md`);
});

test.each(GUIDES)(
  'every shell block of %s.md is valid shell, so a command that is copied does not fail to parse',
  (name) => {
    const broken = codeBlocks(guide(name), 'sh')
      .filter((block) => spawnSync(findOnPath('sh'), ['-n'], { input: block.text }).status !== 0)
      .map((block) => block.text.split('\n')[0]);
    expect(broken).toEqual([]);
  },
);
