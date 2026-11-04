// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { exists, readText } from '../ci/lib/test-support.ts';
import { projectMarkdown, ROOT, relativeLinksOf, tablesOf } from './test-support.ts';

// E19-S10: two rules over the README and every Markdown file under docs/. A link that is relative must lead to a file (or
// a directory) that exists, so that moving or renaming a document breaks the build instead of the reader. A table has the
// plain separator `|---|---|`, one `---` per column and no alignment colons or spaces, which keeps the files diffable and the
// rule of the project one line long. What a document says is asserted elsewhere, against the code it describes.

const SEPARATOR = /^\|(---\|)+$/;

test.each(projectMarkdown())('every relative link of %s leads to a file that exists', (file) => {
  const folder = path.dirname(path.join(ROOT, file));
  const missing = relativeLinksOf(readText(path.join(ROOT, file))).filter(
    (target) => !exists(path.resolve(folder, target)),
  );
  expect(missing).toEqual([]);
});

test.each(projectMarkdown())('the tables of %s use |---| separators', (file) => {
  const separators = tablesOf(readText(path.join(ROOT, file))).map((table) => table.separator);
  expect(separators.filter((separator) => !SEPARATOR.test(separator))).toEqual([]);
});

test.each([
  ['one column', '|---|', true],
  ['two columns', '|---|---|', true],
  ['alignment colons', '|:---|---:|', false],
  ['spaces', '| --- | --- |', false],
  ['a longer dash run', '|----|---|', false],
  ['no separator at all', '', false],
])('the separator rule: %s', (_name, separator, accepted) => {
  expect(SEPARATOR.test(separator)).toBe(accepted);
});
