// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { actor, evaluationOf, requestOf, sha, summaryOf } from './test-support.ts';

// E09-S03, the `Not blocking` section: the unresolved `Co-authored-by` trailers, names only, at most ten, under the sentence
// "These do not change the result." Bot and AI trailers never get here because the engine gives them no advisory.

const CLOSING = 'After fixing, comment `/recheck` or use Re-run. `/recheck` can be used once per minute.';
const INTRO = '### Not blocking\n\nThese do not change the result.';

/** The names of the trailers, by commit number, as the job builds them. */
const trailers = (...rows: readonly (readonly [number, readonly string[]])[]) =>
  new Map(rows.map(([n, names]) => [sha(n), names] as const));

/** A request whose evaluation has an unresolved co-author advisory on each commit named, and a person left unsigned. */
function withAdvisories(coAuthors: ReadonlyMap<string, readonly string[]>, on: readonly number[]) {
  return requestOf({
    evaluation: evaluationOf({
      actors: [actor(1, ['opener'])],
      advisories: on.map((n) => ({ code: 'co_author_unresolved' as const, sha: sha(n) })),
    }),
    names: { logins: new Map([[1, 'octocat']]), coAuthors },
  });
}

test('the section follows the closing line and lists the names under the sentence, as bullets', () => {
  const summary = summaryOf(withAdvisories(trailers([4, ['Jane Roe', 'Pat Poe']]), [4]));
  expect(summary.split('\n\n').slice(-4)).toEqual([
    CLOSING,
    '### Not blocking',
    'These do not change the result.',
    '- `Jane Roe`\n- `Pat Poe`',
  ]);
});

test('there is no Not blocking section when no commit has the advisory, and none when the advisory has no name', () => {
  expect(summaryOf(withAdvisories(trailers(), []))).not.toContain('Not blocking');
  expect(summaryOf(withAdvisories(trailers(), [4]))).not.toContain('Not blocking');
});

test('only the commits that have the advisory are read: names of any other commit are not listed', () => {
  const summary = summaryOf(withAdvisories(trailers([4, ['Listed']], [5, ['Not listed']]), [4]));
  expect(summary).toContain('- `Listed`');
  expect(summary).not.toContain('Not listed');
});

test('an advisory of another kind lists nobody: too many trailers is a count, not a name', () => {
  const request = requestOf({
    evaluation: evaluationOf({
      actors: [actor(1)],
      advisories: [{ code: 'too_many_trailers', sha: sha(4) }],
    }),
    names: { logins: new Map(), coAuthors: trailers([4, ['Hidden']]) },
  });
  expect(summaryOf(request)).not.toContain('Hidden');
});

test('a name repeated on several commits, or after rendering, is listed once, in the order first seen', () => {
  const summary = summaryOf(
    withAdvisories(trailers([4, ['Jane Roe', 'Pat Poe']], [5, ['Pat Poe', 'Jane  Roe', 'Zed']]), [4, 5]),
  );
  expect(summary.endsWith('- `Jane Roe`\n- `Pat Poe`\n- `Zed`')).toBe(true);
});

test('at most ten names are shown, then one visible line for the rest, and the line is not part of the list', () => {
  const names = Array.from({ length: 13 }, (_unused, index) => `Person ${index + 1}`);
  const summary = summaryOf(withAdvisories(trailers([4, names]), [4]));
  const [, tail] = summary.split(`${INTRO}\n\n`);
  expect(tail?.split('\n\n')).toEqual([
    names
      .slice(0, 10)
      .map((name) => `- \`${name}\``)
      .join('\n'),
    '…and 3 more (list truncated)',
  ]);
});

test('exactly ten names have no truncation line', () => {
  const names = Array.from({ length: 10 }, (_unused, index) => `P${index}`);
  const summary = summaryOf(withAdvisories(trailers([4, names]), [4]));
  expect(summary).not.toContain('truncated');
  expect(summary.match(/^- `P/gmu)).toHaveLength(10);
});

test('an empty name is shown as unnamed and an email-shaped name has its @ made inert', () => {
  const summary = summaryOf(withAdvisories(trailers([4, ['', 'a@b.co']]), [4]));
  expect(summary).toContain('- `(unnamed)`\n- `a@​b.co`');
});
