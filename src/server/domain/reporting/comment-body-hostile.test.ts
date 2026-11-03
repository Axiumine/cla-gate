// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { COMMENT_MARKER, commentBody } from './comment-body.ts';
import type { FailureRequest } from './failure-report.ts';
import { failureReport } from './failure-report.ts';
import { MAX_OUTPUT_UNITS } from './output-parts.ts';
import {
  allNames,
  everySlot,
  HOSTILE_ROWS,
  hasUnsafeCharacter,
  outsideCodeSpans,
  showZeroWidth,
  unguardedMarks,
} from './test-support.ts';

// E09-S07, the hostile corpus (src/shared/hostile-names.ts, both lists) in every slot where a name can appear in the pull request
// comment: the login of an unsigned person, the name of the author and of the committer of an unlinked commit, and the name of an
// unresolved co-author. Whatever a name says, the comment keeps its shape, nothing in it acts, and the marker is the one the
// reporter wrote: it appears exactly once, as the first line.

/** The comment for a request. */
const commentOf = (request: FailureRequest): string =>
  commentBody({ kind: 'failure', summary: failureReport(request).view.summary });

/** The lines of a text that are not headings: every heading is fixed text, and the only place a `#` may stand unguarded. */
const withoutHeadings = (text: string): string =>
  text
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n');

/** The comment without its first line, the marker: the one place a raw `<` is meant to stand. */
const afterMarker = (text: string): string => text.slice(text.indexOf('\n') + 1);

test.each(HOSTILE_ROWS)(
  'the comment with %s in every name slot has the marker once, as its first line',
  (_label, name) => {
    const body = commentOf(everySlot(name));
    expect(body.split(COMMENT_MARKER)).toHaveLength(2);
    expect(body.startsWith(`${COMMENT_MARKER}\n`)).toBe(true);
  },
);

test.each(HOSTILE_ROWS)(
  'the comment with %s in every name slot keeps its shape: no extra heading, bullet or step',
  (_label, name) => {
    const lines = commentOf(everySlot(name)).split('\n');
    expect(lines.filter((line) => line.startsWith('#'))).toEqual([
      '## CLA check failed',
      '### Not signed (1)',
      '### Email not linked to a GitHub account (1)',
      '### How to fix',
      '### Not blocking',
    ]);
    expect(lines.filter((line) => line.startsWith('- '))).toHaveLength(3);
    expect(lines.filter((line) => /^\d+\. /u.test(line))).toHaveLength(3);
    expect(lines.filter((line) => line.startsWith('[Sign the CLA]'))).toHaveLength(1);
  },
);

test.each(HOSTILE_ROWS)(
  'the comment with %s in every name slot has no line that is a slash command',
  (_label, name) => {
    const lines = commentOf(everySlot(name)).split('\n');
    expect(lines.filter((line) => line.trim() === '/recheck')).toEqual([]);
    expect(lines.filter((line) => /^\s*\/\w/u.test(line))).toEqual([]);
    expect(lines.filter((line) => line.includes('/recheck') && !line.includes('`/recheck`'))).toEqual([]);
  },
);

test.each(HOSTILE_ROWS)(
  'the comment with %s in every name slot has no mention or issue link outside its fixed text',
  (_label, name) => {
    expect(unguardedMarks(withoutHeadings(commentOf(everySlot(name))))).toEqual([]);
  },
);

test.each(HOSTILE_ROWS)('the comment with %s in every name slot has no raw < outside a code span', (_label, name) => {
  expect(outsideCodeSpans(afterMarker(commentOf(everySlot(name))))).not.toContain('<');
});

test.each(HOSTILE_ROWS)(
  'the comment with %s in every name slot holds no control character, is well formed and fits the limit',
  (_label, name) => {
    const body = commentOf(everySlot(name));
    expect(body.split('\n').filter((line) => hasUnsafeCharacter(line))).toEqual([]);
    expect(body.isWellFormed()).toBe(true);
    expect(body.length).toBeLessThanOrEqual(MAX_OUTPUT_UNITS);
  },
);

test('both lists in every slot at once give the comment that is stored in the snapshot', async () => {
  const rendered = showZeroWidth(commentOf(allNames()));
  await expect(`# Pull request comment over both hostile lists (E09-S07)\n\n${rendered}\n`).toMatchFileSnapshot(
    'snapshots/comment-hostile.md',
  );
});

test('both lists in every slot at once give a comment with the marker once, no unguarded mark and no raw <', () => {
  const body = commentOf(allNames());
  expect(body.split(COMMENT_MARKER)).toHaveLength(2);
  expect(unguardedMarks(withoutHeadings(body))).toEqual([]);
  expect(outsideCodeSpans(afterMarker(body))).not.toContain('<');
  expect(body).toContain('…and 24 more (list truncated)');
});
