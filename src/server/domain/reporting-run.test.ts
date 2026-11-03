// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { evaluatePullRequest } from './evaluation/index.ts';
import { commitFacts, evaluationInput, signatureFact } from './evaluation/test-support.ts';
import { renderCheckOutput } from './reporting/check-output.ts';
import { type RowResult, runReport } from './reporting/run-report.ts';
import { HEAD, NO_NAMES, requestOf } from './reporting/test-support.ts';

// E09-S05: the Check Run of a head SHA that several pull requests can share, over the verdicts of the real engine. The run says
// the worst `result` among the rows (`failure` over `in_progress` over `success`); `cancelled` is a closed pull request and
// counts for nothing. A pull request that fails shows its own failure whole; one that passes shows the worst of the others.

const PASSING = evaluatePullRequest(evaluationInput({ commits: [commitFacts(1)], signatures: [signatureFact(1, 1)] }));
const FAILING = evaluatePullRequest(evaluationInput({ commits: [commitFacts(1)] }));

/** The request of the verdict, for pull request 7 of repository 4242. */
const request = (evaluation: typeof PASSING) => ({ ...requestOf({ names: NO_NAMES }), evaluation });

test('a passing pull request with no other row passes, with the counts of its own verdict', () => {
  const { view, signUrl } = runReport(request(PASSING), []);
  expect(view).toEqual({ kind: 'success', headSha: HEAD, covered: { signature: 1, allowlist: 0, override: 0 } });
  expect(signUrl).toBeNull();
});

test.each([
  ['success', 'CLA check passed'],
  ['cancelled', 'CLA check passed'],
] as const)('a passing pull request next to a row that is %s still passes', (other: RowResult, title) => {
  expect(renderCheckOutput(runReport(request(PASSING), [other]).view).title).toBe(title);
});

test('a passing pull request next to one that fails makes the run fail, with no name, no count and no link', () => {
  const { view, signUrl } = runReport(request(PASSING), ['success', 'failure', 'in_progress']);
  expect(view).toEqual({ kind: 'failure', headSha: HEAD, unsigned: 0, unlinked: 0, summary: [] });
  expect(signUrl).toBeNull();
  expect(renderCheckOutput(view)).toEqual({
    status: 'completed',
    conclusion: 'failure',
    title: 'CLA check failed',
    summary: 'The CLA check did not pass for commit 1a2b3c4. Comment `/recheck` to run it again.',
  });
});

test('a passing pull request next to one still being evaluated keeps the run in progress', () => {
  const { view, signUrl } = runReport(request(PASSING), ['success', 'in_progress']);
  expect(view).toEqual({ kind: 'in_progress', headSha: HEAD });
  expect(signUrl).toBeNull();
});

test.each([[[]], [['success']], [['in_progress']], [['failure']], [['cancelled', 'in_progress', 'failure']]] as const)(
  'a failing pull request shows its own failure and its sign link whatever the others are (%j)',
  (others: readonly RowResult[]) => {
    const { view, signUrl } = runReport(request(FAILING), others);
    expect(view).toMatchObject({ kind: 'failure', headSha: HEAD, unsigned: 1, unlinked: 0 });
    expect(signUrl).toBe('https://cla.example.test/sign/4242?pr=7');
  },
);
