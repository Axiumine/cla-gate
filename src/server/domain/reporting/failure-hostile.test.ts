// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { HOSTILE_CONTROL_NAMES, HOSTILE_NAMES } from '../../../shared/hostile-names.ts';
import { renderCheckOutput } from './check-output.ts';
import type { FailureRequest } from './failure-report.ts';
import { failureReport } from './failure-report.ts';
import { MAX_OUTPUT_UNITS } from './output-parts.ts';
import {
  actor,
  evaluationOf,
  finding,
  HOSTILE_ROWS,
  hasUnsafeCharacter,
  outsideCodeSpans,
  requestOf,
  sha,
  showZeroWidth,
  unguardedMarks,
} from './test-support.ts';

// E09-S03, the hostile corpus (src/shared/hostile-names.ts, both lists) in every slot where a name can appear in the failure
// report: the login of an unsigned person, the name of the author and of the committer of an unlinked commit, and the name
// of an unresolved co-author. Whatever a name says, the output keeps its shape and nothing in it acts.

const MARKER = '<!-- cla-platform:license/cla:v1 -->';

/** The headings of a report that has every section and a count of one in each list. */
const HEADINGS = [
  '### Not signed (1)',
  '### Email not linked to a GitHub account (1)',
  '### How to fix',
  '### Not blocking',
];

/** A request that puts `name` in every slot: one unsigned login, one unlinked author, one unlinked committer, one co-author. */
function everySlot(name: string): FailureRequest {
  return requestOf({
    evaluation: evaluationOf({
      actors: [actor(1, ['opener', 'author'])],
      findings: [finding(2, name, 'author'), finding(2, name, 'committer')],
      advisories: [{ code: 'co_author_unresolved', sha: sha(3) }],
    }),
    names: { logins: new Map([[1, name]]), coAuthors: new Map([[sha(3), [name]]]) },
  });
}

/** The title and summary of the Check Run for a request, as one text. */
function outputOf(request: FailureRequest): string {
  const { title, summary } = renderCheckOutput(failureReport(request).view);
  return `${title}\n\n${summary}`;
}

/** The lines of a text that are not headings: every heading is fixed text, and the only place a `#` may stand unguarded. */
const body = (text: string): string =>
  text
    .split('\n')
    .filter((line) => !line.startsWith('### '))
    .join('\n');

test('the corpus is both lists of src/shared, with no copy of them', () => {
  expect(HOSTILE_ROWS.map(([, name]) => name)).toEqual([...HOSTILE_NAMES, ...HOSTILE_CONTROL_NAMES]);
});

test.each(HOSTILE_ROWS)(
  'the report with %s in every name slot keeps its shape: no extra heading, bullet or step',
  (_label, name) => {
    const lines = outputOf(everySlot(name)).split('\n');
    expect(lines.filter((line) => line.startsWith('### '))).toEqual(HEADINGS);
    expect(lines.filter((line) => line.startsWith('- '))).toHaveLength(3);
    expect(lines.filter((line) => /^\d+\. /u.test(line))).toHaveLength(3);
    expect(lines.filter((line) => line.startsWith('[Sign the CLA]'))).toHaveLength(1);
  },
);

test.each(HOSTILE_ROWS)('the report with %s in every name slot has no line that is a slash command', (_label, name) => {
  const lines = outputOf(everySlot(name)).split('\n');
  expect(lines.filter((line) => line.trim() === '/recheck')).toEqual([]);
  expect(lines.filter((line) => /^\s*\/\w/u.test(line))).toEqual([]);
  expect(lines.filter((line) => line.includes('/recheck') && !line.includes('`/recheck`'))).toEqual([]);
});

test.each(HOSTILE_ROWS)(
  'the report with %s in every name slot has no mention or issue link outside its fixed text',
  (_label, name) => {
    expect(unguardedMarks(body(outputOf(everySlot(name))))).toEqual([]);
  },
);

test.each(HOSTILE_ROWS)('the report with %s in every name slot has no raw < outside a code span', (_label, name) => {
  expect(outsideCodeSpans(outputOf(everySlot(name)))).not.toContain('<');
});

test.each(HOSTILE_ROWS)(
  'the report with %s in every name slot never spells the comment marker of the pull request comment',
  (_label, name) => {
    expect(outputOf(everySlot(name)).split(MARKER)).toHaveLength(1);
  },
);

test.each(HOSTILE_ROWS)(
  'the report with %s in every name slot holds no control character, is well formed and fits the limit',
  (_label, name) => {
    const { summary } = renderCheckOutput(failureReport(everySlot(name)).view);
    expect(summary.split('\n').filter((line) => hasUnsafeCharacter(line))).toEqual([]);
    expect(summary.isWellFormed()).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(MAX_OUTPUT_UNITS);
  },
);

/** Both lists in every slot at once: 34 unsigned people, 34 unlinked commits, and the co-authors of one commit. */
function allNames(): FailureRequest {
  const names = [...HOSTILE_NAMES, ...HOSTILE_CONTROL_NAMES];
  return requestOf({
    evaluation: evaluationOf({
      actors: names.map((_name, index) => actor(index + 1, ['opener', 'author'])),
      findings: names.map((name, index) => finding(index + 1, name, index % 2 === 0 ? 'author' : 'committer')),
      advisories: [{ code: 'co_author_unresolved', sha: sha(900) }],
    }),
    names: { logins: new Map(names.map((name, index) => [index + 1, name])), coAuthors: new Map([[sha(900), names]]) },
  });
}

test('both lists in every slot at once give the report that is stored in the snapshot', async () => {
  const rendered = showZeroWidth(outputOf(allNames()));
  await expect(`# Failure report over both hostile lists (E09-S03)\n\n${rendered}\n`).toMatchFileSnapshot(
    'snapshots/failure-hostile.md',
  );
});

test('both lists in every slot at once show 10 co-authors, the lists in full, and the fixed text once', () => {
  const output = outputOf(allNames());
  expect(output.split('\n').filter((line) => line.startsWith('### '))).toEqual([
    '### Not signed (34)',
    '### Email not linked to a GitHub account (34)',
    '### How to fix',
    '### Not blocking',
  ]);
  expect(output).toContain('…and 24 more (list truncated)');
  expect(output.split(MARKER)).toHaveLength(1);
  expect(unguardedMarks(body(output))).toEqual([]);
  expect(outsideCodeSpans(output)).not.toContain('<');
});
