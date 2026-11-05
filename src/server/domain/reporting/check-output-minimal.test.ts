// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { renderCheckOutput } from './check-output.ts';
import { minimalCheckOutput } from './check-output-minimal.ts';
import type { CheckView } from './check-view.ts';
import { InvalidIdError, InvalidShaError, renderName } from './encode.ts';
import { HEAD, HOSTILE_ROWS } from './test-support.ts';

// E09-S06, the output a Check Run is given when GitHub answers 422 to the full one: the status, the conclusion and the title of
// the view, a summary of at most 500 characters that holds the counts and the `/recheck` hint, no `text`, and no name.

const COVERED = { signature: 2, allowlist: 1, corporate: 0, override: 1 };

/** A failed view whose sections carry a hostile name, as the first attempt did. */
function failureWith(name: string, unsigned: number, unlinked: number): Extract<CheckView, { kind: 'failure' }> {
  return {
    kind: 'failure',
    headSha: HEAD,
    unsigned,
    unlinked,
    summary: [{ kind: 'list', entries: [`- ${renderName(name)}`] }],
    text: [{ kind: 'text', text: 'Detail that GitHub would not take.' }],
  };
}

test('a success keeps its conclusion and title and states the counts and the hint', () => {
  expect(minimalCheckOutput({ kind: 'success', headSha: HEAD, covered: COVERED })).toEqual({
    status: 'completed',
    conclusion: 'success',
    title: 'CLA check passed',
    summary:
      '4 contributors covered: 2 by signature, 1 by allowlist rule, 1 by maintainer override. Comment `/recheck` to run it again.',
  });
});

test.each([
  [3, 2, 'CLA signature required: 3 unsigned, 2 unlinked', ' (3 unsigned, 2 unlinked)'],
  [1, 0, 'CLA signature required: 1 unsigned', ' (1 unsigned)'],
  [0, 4, 'CLA signature required: 4 unlinked', ' (4 unlinked)'],
  [0, 0, 'CLA check failed', ''],
])(
  'a failure of %i unsigned and %i unlinked keeps the conclusion and the title %j and states the counts',
  (unsigned, unlinked, title, counts) => {
    expect(minimalCheckOutput(failureWith('octocat', unsigned, unlinked))).toEqual({
      status: 'completed',
      conclusion: 'failure',
      title,
      summary: `The CLA check did not pass for commit 1a2b3c4${counts}. The details could not be shown here. Comment \`/recheck\` to run it again.`,
    });
  },
);

test.each(HOSTILE_ROWS)('a failure that listed the name %s says nothing of it and carries no text', (_label, name) => {
  const output = minimalCheckOutput(failureWith(name, 1, 1));
  expect(output).not.toHaveProperty('text');
  expect(output).toEqual(minimalCheckOutput(failureWith('octocat', 1, 1)));
  expect(output.summary).not.toMatch(/[@#<>[\]]/u);
});

test.each([
  ['in progress', { kind: 'in_progress', headSha: HEAD }],
  ['cancelled', { kind: 'cancelled' }],
  ['disabled', { kind: 'enforcement_disabled' }],
  ['could not complete', { kind: 'evaluation_failed' }],
] as const)('a %s check has nothing a person wrote, so its output is the full one', (_what, view) => {
  expect(minimalCheckOutput(view)).toEqual(renderCheckOutput(view));
});

test('the status and the conclusion are those of the full output for every view, so a rejected text never leaves a run pending', () => {
  const views: CheckView[] = [
    { kind: 'success', headSha: HEAD, covered: COVERED },
    failureWith('octocat', 1, 1),
    { kind: 'in_progress', headSha: HEAD },
    { kind: 'cancelled' },
    { kind: 'enforcement_disabled' },
    { kind: 'evaluation_failed' },
  ];
  for (const view of views) {
    const minimal = minimalCheckOutput(view);
    const full = renderCheckOutput(view);
    expect([minimal.status, minimal.conclusion, minimal.title]).toEqual([full.status, full.conclusion, full.title]);
  }
});

test('no summary is longer than 500 characters, even with the largest counts', () => {
  const most = Number.MAX_SAFE_INTEGER;
  const views: CheckView[] = [
    failureWith('octocat', most, most),
    { kind: 'success', headSha: HEAD, covered: { signature: most, allowlist: 0, corporate: 0, override: 0 } },
    { kind: 'in_progress', headSha: HEAD },
    { kind: 'cancelled' },
    { kind: 'enforcement_disabled' },
    { kind: 'evaluation_failed' },
  ];
  for (const view of views) {
    expect(minimalCheckOutput(view).summary.length).toBeLessThanOrEqual(500);
  }
});

test('a head SHA that is not a full SHA and a count that is not a number are refused as they are in the full output', () => {
  expect(() => minimalCheckOutput({ kind: 'success', headSha: 'main', covered: COVERED })).toThrow(InvalidShaError);
  expect(() => minimalCheckOutput({ ...failureWith('octocat', 1, 1), headSha: 'main' })).toThrow(InvalidShaError);
  expect(() => minimalCheckOutput(failureWith('octocat', -1, 0))).toThrow(InvalidIdError);
});
