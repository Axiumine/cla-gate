// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { evaluatePullRequest } from './evaluation/index.ts';
import { account, commitFacts, corporateCover, evaluationInput, signatureFact } from './evaluation/test-support.ts';
import { renderCheckOutput } from './reporting/check-output.ts';
import { minimalCheckOutput } from './reporting/check-output-minimal.ts';
import { commentBody } from './reporting/comment-body.ts';
import { type RunRequest, runReport } from './reporting/run-report.ts';
import { requestOf } from './reporting/test-support.ts';

// E21-S05: what the Check Run and the comment say when an approval of a corporate CLA covers people, over the verdicts of the real engine. The
// words are "covered by a corporate CLA"; the numbers are counts; and nothing of the company, the domain, the organisation or the ids of the
// agreement and the approval gets out, because the report is not given any of them.

/** The ids no sentence may repeat: the agreement and the approval that cover the opener, which are numbers nobody reads by chance. */
const AGREEMENT = 424_242;
const APPROVAL = 737_373;

/** What the flow knows about the company, which no output may hold. */
const COMPANY_FACTS = ['Acme GmbH', 'acme.example', 'Acme-Org', String(AGREEMENT), String(APPROVAL)];

/** The request of a report over the verdict of `input`, with the logins the job saw. */
function runRequest(input: ReturnType<typeof evaluationInput>): RunRequest {
  const evaluation = evaluatePullRequest(input);
  const base = requestOf({
    evaluation,
    names: {
      logins: new Map([
        [1, 'opener'],
        [2, 'committer'],
      ]),
      coAuthors: new Map(),
    },
  });
  return { ...base, evaluation };
}

/** Every text the verdict reaches a person as: the Check Run in full and in its minimal form, and the comment. */
function everyText(input: ReturnType<typeof evaluationInput>): string[] {
  const { view, comment } = runReport(runRequest(input), []);
  const output = renderCheckOutput(view);
  const minimal = minimalCheckOutput(view);
  return [output.title, output.summary, output.text ?? '', minimal.summary, commentBody(comment)];
}

const COVERED_OPENER = corporateCover([1, AGREEMENT, APPROVAL]);

test('a pull request covered by a corporate CLA and a signature passes, and the Check Run and the comment say who is covered by what', () => {
  const input = evaluationInput({
    commits: [commitFacts(2, { author: account(2), committer: account(2) })],
    signatures: [signatureFact(1, 2)],
    corporateCovered: COVERED_OPENER,
  });
  const { view, comment } = runReport(runRequest(input), []);
  expect(view).toMatchObject({ kind: 'success', covered: { signature: 1, corporate: 1, allowlist: 0, override: 0 } });
  const output = renderCheckOutput(view);
  expect(output.conclusion).toBe('success');
  expect(output.summary).toContain('2 contributors covered: 1 by signature, 1 by corporate CLA.');
  expect(output.summary).toContain('1 contributor is covered by a corporate CLA.');
  expect(comment).toEqual({ kind: 'success', headSha: view.kind === 'success' ? view.headSha : '', corporate: 1 });
  expect(commentBody(comment)).toContain('have signed the CLA or are covered by a corporate CLA for commit');
  expect(commentBody(comment)).toContain('1 contributor is covered by a corporate CLA.');
  expect(minimalCheckOutput(view).summary).toContain('1 by corporate CLA');
});

test('a pull request that nobody a corporate CLA covers keeps the words it had: no corporate sentence appears', () => {
  const input = evaluationInput({ signatures: [signatureFact(1, 1)] });
  for (const text of everyText(input)) {
    expect(text).not.toContain('corporate');
  }
  expect(commentBody(runReport(runRequest(input), []).comment)).toContain(
    'All contributors have signed the CLA for commit',
  );
});

test('a pull request whose opener is covered but whose committer has not signed still fails, and says how many a corporate CLA covers', () => {
  const input = evaluationInput({
    commits: [commitFacts(2, { author: account(2), committer: account(2) })],
    corporateCovered: COVERED_OPENER,
  });
  const { view, comment } = runReport(runRequest(input), []);
  expect(view).toMatchObject({ kind: 'failure', unsigned: 1, unlinked: 0 });
  const summary = renderCheckOutput(view).summary;
  expect(summary).toContain('### Not signed (1)');
  expect(summary).toContain('GitHub id 2');
  expect(summary).not.toContain('GitHub id 1)');
  expect(summary).toContain('1 contributor is covered by a corporate CLA.');
  expect(commentBody(comment)).toContain('1 contributor is covered by a corporate CLA.');
});

test('an author uncovered only because the agreement is of an earlier version is told to ask the CLA manager to sign the current one', () => {
  const input = evaluationInput({
    commits: [commitFacts(2, { author: account(2), committer: account(2) })],
    corporateOutdated: new Set([2]),
  });
  const { view, comment } = runReport(runRequest(input), []);
  const note = 'ask the CLA manager to sign the current version';
  const entries = renderCheckOutput(view)
    .summary.split('\n')
    .filter((line) => line.startsWith('- '));
  expect(entries).toHaveLength(2);
  expect(entries.filter((line) => line.includes(note))).toEqual([expect.stringContaining('GitHub id 2')]);
  expect(commentBody(comment)).toContain(note);
});

test('no sentence of any output names the company, the domain, the organisation, the agreement or the approval', () => {
  const inputs = [
    evaluationInput({ corporateCovered: COVERED_OPENER }),
    evaluationInput({
      commits: [commitFacts(2, { author: account(2), committer: account(2) })],
      corporateCovered: COVERED_OPENER,
      corporateOutdated: new Set([2]),
    }),
  ];
  for (const input of inputs) {
    for (const text of everyText(input)) {
      for (const fact of COMPANY_FACTS) {
        expect(text).not.toContain(fact);
      }
    }
  }
});
