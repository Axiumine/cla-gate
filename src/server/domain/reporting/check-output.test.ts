// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, expectTypeOf, test } from 'vitest';
import { ENFORCEMENT_DISABLED_SUMMARY, renderCheckOutput } from './check-output.ts';
import type { CheckConclusion, CheckOutput, CheckView, CoverageCounts } from './check-view.ts';
import { InvalidIdError, InvalidShaError } from './encode.ts';

// E09-S02, the mapping of a view to a Check Run: the status and conclusion, the fixed titles, the sentences a contributor
// reads and the guards on the data that is printed. The length rules are in check-output-limits.test.ts.

const HEAD = '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b';
const NONE: CoverageCounts = { signature: 0, allowlist: 0, corporate: 0, override: 0 };

type Success = Extract<CheckView, { kind: 'success' }>;
type Failure = Extract<CheckView, { kind: 'failure' }>;

function success(covered: Partial<CoverageCounts>): Success {
  return { kind: 'success', headSha: HEAD, covered: { ...NONE, ...covered } };
}

function failure(unsigned: number, unlinked: number): Failure {
  return { kind: 'failure', headSha: HEAD, unsigned, unlinked, summary: [{ kind: 'text', text: 'Sections.' }] };
}

test.each([
  ['success', success({ signature: 1 }), 'completed', 'success'],
  ['failure', failure(1, 0), 'completed', 'failure'],
  ['in_progress', { kind: 'in_progress', headSha: HEAD }, 'in_progress', undefined],
  ['cancelled', { kind: 'cancelled' }, 'completed', 'cancelled'],
  ['enforcement_disabled', { kind: 'enforcement_disabled' }, 'completed', 'neutral'],
  ['evaluation_failed', { kind: 'evaluation_failed' }, 'completed', 'failure'],
] as const)('the %s view is %s with the conclusion %s', (_kind, view, status, conclusion) => {
  const output = renderCheckOutput(view);
  expect(output.status).toBe(status);
  expect(output.conclusion).toBe(conclusion);
});

test('an in-progress check has no conclusion key at all, and a success has no text key', () => {
  expect(renderCheckOutput({ kind: 'in_progress', headSha: HEAD })).not.toHaveProperty('conclusion');
  expect(renderCheckOutput(success({ signature: 2 }))).not.toHaveProperty('text');
});

test('the conclusion is the union of the four the App emits, and the status the two it uses', () => {
  expectTypeOf<CheckConclusion>().toEqualTypeOf<'success' | 'failure' | 'neutral' | 'cancelled'>();
  expectTypeOf<CheckOutput['status']>().toEqualTypeOf<'in_progress' | 'completed'>();
});

test.each([
  ['success', success({ signature: 1 }), 'CLA check passed'],
  ['in progress', { kind: 'in_progress', headSha: HEAD }, 'Checking CLA signatures'],
  ['cancelled', { kind: 'cancelled' }, 'CLA check cancelled'],
  ['disabled', { kind: 'enforcement_disabled' }, 'CLA enforcement is disabled for this repository'],
  ['could not complete', { kind: 'evaluation_failed' }, 'CLA check could not complete'],
  ['3 unsigned and 2 unlinked', failure(3, 2), 'CLA signature required: 3 unsigned, 2 unlinked'],
  ['1 unsigned', failure(1, 0), 'CLA signature required: 1 unsigned'],
  ['4 unlinked', failure(0, 4), 'CLA signature required: 4 unlinked'],
  ['no count at all', failure(0, 0), 'CLA check failed'],
] as const)('the title of the %s view is fixed: %s', (_what, view, title) => {
  expect(renderCheckOutput(view).title).toBe(title);
});

test('no title is longer than 100 characters, even with the largest counts', () => {
  const most = Number.MAX_SAFE_INTEGER;
  const views: CheckView[] = [
    failure(most, most),
    success({ signature: most }),
    { kind: 'in_progress', headSha: HEAD },
    { kind: 'cancelled' },
    { kind: 'enforcement_disabled' },
    { kind: 'evaluation_failed' },
  ];
  for (const view of views) {
    expect(renderCheckOutput(view).title.length).toBeLessThanOrEqual(100);
  }
  expect(renderCheckOutput(failure(most, most)).title).toBe(
    'CLA signature required: 9007199254740991 unsigned, 9007199254740991 unlinked',
  );
});

test.each([
  [
    'all three bases',
    { signature: 2, allowlist: 1, override: 1 },
    '4 contributors covered: 2 by signature, 1 by allowlist rule, 1 by maintainer override.',
  ],
  [
    'zero counts are omitted',
    { signature: 3, override: 2 },
    '5 contributors covered: 3 by signature, 2 by maintainer override.',
  ],
  ['one basis only', { allowlist: 7 }, '7 contributors covered: 7 by allowlist rule.'],
  ['one contributor', { signature: 1 }, '1 contributor covered: 1 by signature.'],
  ['nobody to count', {}, '0 contributors covered.'],
] as const)('the success summary states the count per covering basis: %s', (_what, covered, sentence) => {
  expect(renderCheckOutput(success(covered)).summary).toBe(`${sentence}\n\nChecked commit 1a2b3c4.`);
});

test('every view renders the sentences a contributor reads', () => {
  expect(renderCheckOutput(success({ signature: 2, allowlist: 1, override: 1 }))).toMatchInlineSnapshot(`
    {
      "conclusion": "success",
      "status": "completed",
      "summary": "4 contributors covered: 2 by signature, 1 by allowlist rule, 1 by maintainer override.

    Checked commit 1a2b3c4.",
      "title": "CLA check passed",
    }
  `);
  expect(renderCheckOutput(failure(2, 1))).toMatchInlineSnapshot(`
    {
      "conclusion": "failure",
      "status": "completed",
      "summary": "Sections.",
      "title": "CLA signature required: 2 unsigned, 1 unlinked",
    }
  `);
  expect(renderCheckOutput({ kind: 'in_progress', headSha: HEAD })).toMatchInlineSnapshot(`
    {
      "status": "in_progress",
      "summary": "Evaluating commit 1a2b3c4. This updates automatically. Comment \`/recheck\` to run it again.",
      "title": "Checking CLA signatures",
    }
  `);
  expect(renderCheckOutput({ kind: 'cancelled' })).toMatchInlineSnapshot(`
    {
      "conclusion": "cancelled",
      "status": "completed",
      "summary": "This pull request was closed before the check finished.",
      "title": "CLA check cancelled",
    }
  `);
  expect(renderCheckOutput({ kind: 'enforcement_disabled' })).toMatchInlineSnapshot(`
    {
      "conclusion": "neutral",
      "status": "completed",
      "summary": "The maintainers turned CLA enforcement off for this repository. If \`license/cla\` is a required check in branch protection, remove it from the required checks or ask the maintainers to re-enable enforcement.",
      "title": "CLA enforcement is disabled for this repository",
    }
  `);
});

test('a check whose evaluation could not complete fails with the fixed title and the sentence that sends the contributor to /recheck (E09-S06)', () => {
  expect(renderCheckOutput({ kind: 'evaluation_failed' })).toMatchInlineSnapshot(`
    {
      "conclusion": "failure",
      "status": "completed",
      "summary": "Something went wrong while checking this pull request. Comment \`/recheck\` to try again.",
      "title": "CLA check could not complete",
    }
  `);
});

test('the disabled summary is the one fixed sentence, exported for the reporter to reuse', () => {
  expect(ENFORCEMENT_DISABLED_SUMMARY).toBe(
    'The maintainers turned CLA enforcement off for this repository. If `license/cla` is a required check in branch ' +
      'protection, remove it from the required checks or ask the maintainers to re-enable enforcement.',
  );
  expect(renderCheckOutput({ kind: 'enforcement_disabled' }).summary).toBe(ENFORCEMENT_DISABLED_SUMMARY);
});

test('the summaries of a success, an in-progress, a cancelled, a disabled and a could-not-complete check name no one', () => {
  const views: CheckView[] = [
    success({ signature: 2 }),
    { kind: 'in_progress', headSha: HEAD },
    { kind: 'cancelled' },
    { kind: 'enforcement_disabled' },
    { kind: 'evaluation_failed' },
  ];
  const outputs = views.map((view) => renderCheckOutput(view));
  for (const output of outputs) {
    expect(`${output.title}\n${output.summary}`).not.toMatch(/[@#<]|https?:/u);
  }
});

test('a failure shows the sections it is given as the summary, the text when there is one', () => {
  const view: CheckView = {
    kind: 'failure',
    headSha: HEAD,
    unsigned: 1,
    unlinked: 0,
    summary: [
      { kind: 'text', text: '### Not signed (1)' },
      { kind: 'list', entries: ['- `octocat`'] },
    ],
    text: [{ kind: 'text', text: 'More detail.' }],
  };
  expect(renderCheckOutput(view)).toEqual({
    status: 'completed',
    conclusion: 'failure',
    title: 'CLA signature required: 1 unsigned',
    summary: '### Not signed (1)\n\n- `octocat`',
    text: 'More detail.',
  });
});

test('a failure without sections still has a summary, because GitHub wants one', () => {
  const output = renderCheckOutput({ kind: 'failure', headSha: HEAD, unsigned: 0, unlinked: 0, summary: [] });
  expect(output.summary).toBe('The CLA check did not pass for commit 1a2b3c4. Comment `/recheck` to run it again.');
  expect(output).not.toHaveProperty('text');
});

test('a failure whose text parts are all empty has no text', () => {
  const view: CheckView = { ...failure(1, 0), text: [{ kind: 'list', entries: [] }] };
  expect(renderCheckOutput(view)).not.toHaveProperty('text');
});

test.each([
  ['a negative count', success({ signature: -1 })],
  ['a fractional count', success({ allowlist: 1.5 })],
  ['a count that is not a number', success({ override: Number.NaN })],
  ['a count past the safe integers', success({ signature: Number.MAX_SAFE_INTEGER + 1 })],
  ['a negative unsigned count', failure(-1, 0)],
  ['an unlinked count of infinity', failure(0, Number.POSITIVE_INFINITY)],
] as const)('%s is refused, whatever the other counts are', (_what, view) => {
  expect(() => renderCheckOutput(view)).toThrow(InvalidIdError);
});

test.each([
  ['a success', (headSha: string): CheckView => ({ ...success({ signature: 1 }), headSha }), '@everyone'],
  ['an in-progress check', (headSha: string): CheckView => ({ kind: 'in_progress', headSha }), 'HEAD'],
  ['a failure with sections', (headSha: string): CheckView => ({ ...failure(1, 0), headSha }), `${HEAD}0`],
  [
    'a failure with none',
    (headSha: string): CheckView => ({ ...failure(0, 0), headSha, summary: [] }),
    HEAD.toUpperCase(),
  ],
] as const)('%s with a head that is not a full lower-case SHA is refused', (_what, view, bad) => {
  expect(() => renderCheckOutput(view(bad))).toThrow(InvalidShaError);
});
