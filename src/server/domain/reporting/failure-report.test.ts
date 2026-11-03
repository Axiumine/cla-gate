// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { InvalidSignLinkError } from '../../../shared/sign-link.ts';
import { renderCheckOutput } from './check-output.ts';
import { InvalidIdError, InvalidShaError } from './encode.ts';
import { failureReport } from './failure-report.ts';
import { actor, evaluationOf, finding, HEAD, NO_NAMES, requestOf, sha, summaryOf } from './test-support.ts';

// E09-S03, the sections of the failure report: which appear, in which order, and the exact words of each. The people, the
// commits and the co-authors in detail are in failure-people.test.ts, failure-commits.test.ts and failure-advisories.test.ts.

const SIGN_LINK = '[Sign the CLA](https://cla.example.test/sign/4242?pr=7)';
const CLOSING = 'After fixing, comment `/recheck` or use Re-run. `/recheck` can be used once per minute.';
const NAMES = { logins: new Map([[11, 'octocat']]), coAuthors: new Map([[sha(9), ['Jane Roe']]]) };

const UNSIGNED = evaluationOf({ actors: [actor(11, ['opener', 'author'])] });
const UNLINKED = evaluationOf({
  failureCodes: ['unlinked_identity'],
  findings: [finding(5, 'Jane Doe')],
});
const BOTH = evaluationOf({
  failureCodes: ['unlinked_identity', 'unsigned_contributor'],
  actors: [actor(11, ['opener', 'author'])],
  findings: [finding(5, 'Jane Doe')],
});

test('a failure with only unsigned people has the sign link, the list and the closing line, and no fix steps', () => {
  expect(summaryOf(requestOf({ evaluation: UNSIGNED, names: NAMES }))).toBe(
    [SIGN_LINK, '### Not signed (1)', '- `octocat` (GitHub id 11): opened the PR, commit author', CLOSING].join('\n\n'),
  );
});

test('a failure with only unlinked commits has no sign link and no Not signed section, and has the fix steps', () => {
  const summary = summaryOf(requestOf({ evaluation: UNLINKED }));
  expect(summary).not.toContain('Sign the CLA');
  expect(summary).not.toContain('Not signed');
  expect(summary.startsWith('### Email not linked to a GitHub account (1)\n\n')).toBe(true);
  expect(summary).toContain('- commit `0000005`: authored as `Jane Doe` (email not linked to a GitHub account)');
  expect(summary).toContain('### How to fix');
});

test('a failure with both has every section, in the order sign link, Not signed, Email not linked, How to fix, closing line', () => {
  const summary = summaryOf(requestOf({ evaluation: BOTH, names: NAMES }));
  const order = [
    SIGN_LINK,
    '### Not signed (1)',
    '### Email not linked to a GitHub account (1)',
    '### How to fix',
    CLOSING,
  ];
  const places = order.map((text) => summary.indexOf(text));
  expect(places.every((place) => place >= 0)).toBe(true);
  expect(places).toEqual([...places].sort((a, b) => a - b));
});

test('the sections are separated by one blank line and nothing else is written between them', () => {
  const summary = summaryOf(requestOf({ evaluation: BOTH, names: NAMES }));
  expect(summary.split('\n\n').map((block) => block.split('\n')[0])).toEqual([
    SIGN_LINK,
    '### Not signed (1)',
    '- `octocat` (GitHub id 11): opened the PR, commit author',
    '### Email not linked to a GitHub account (1)',
    '- commit `0000005`: authored as `Jane Doe` (email not linked to a GitHub account)',
    '### How to fix',
    'Read the email of a commit with `git log -1 --format=%ae <sha>`.',
    '1. Add and verify the commit email at https://github.com/settings/emails.',
    CLOSING,
  ]);
});

test('the How to fix section holds the three steps verbatim and the command that reads the email of a commit', () => {
  const summary = summaryOf(requestOf({ evaluation: UNLINKED }));
  expect(summary).toContain(
    [
      '### How to fix',
      '',
      'Read the email of a commit with `git log -1 --format=%ae <sha>`.',
      '',
      '1. Add and verify the commit email at https://github.com/settings/emails.',
      '2. Or set a linked address and rewrite the commits with `git config user.email "<linked email>"`, ' +
        "`git rebase <base> --exec 'git commit --amend --reset-author --no-edit'` and `git push --force-with-lease`.",
      '3. Or ask a maintainer to record an exception for the listed commits (an exception never counts as a signature).',
    ].join('\n'),
  );
});

test('the closing line ends every report that has no Not blocking section, whatever the failure', () => {
  for (const evaluation of [UNSIGNED, UNLINKED, BOTH, evaluationOf({ failureCodes: ['no_active_cla'] })]) {
    expect(summaryOf(requestOf({ evaluation, names: NAMES })).endsWith(CLOSING)).toBe(true);
  }
});

test('the sign link is the address of the sign page of the repository by numeric id and the pull request, and it holds nothing else', () => {
  const report = failureReport(requestOf({ evaluation: BOTH, names: NAMES, githubRepoId: 777, prNumber: 31 }));
  expect(report.signUrl).toBe('https://cla.example.test/sign/777?pr=31');
  const text = renderCheckOutput(report.view).summary;
  expect(text).toContain('[Sign the CLA](https://cla.example.test/sign/777?pr=31)');
  const link = text.slice(text.indexOf('(https') + 1, text.indexOf(')\n'));
  expect(link).not.toMatch(/octocat|jane|@|token|[0-9a-f]{7,}/iu);
});

test('there is no address for the details of the Check Run when there is no sign link', () => {
  expect(failureReport(requestOf({ evaluation: UNLINKED })).signUrl).toBeNull();
});

test('the counts of the view are the people and the commits, which the title states', () => {
  const report = failureReport(
    requestOf({
      evaluation: evaluationOf({
        actors: [actor(11), actor(12, ['committer']), actor(13, ['opener'], true)],
        findings: [finding(5, 'A'), finding(5, 'A', 'committer'), finding(6, 'B'), finding(7, 'C', 'author', 99)],
      }),
    }),
  );
  expect(report.view).toMatchObject({ kind: 'failure', headSha: HEAD, unsigned: 2, unlinked: 2 });
  expect(renderCheckOutput(report.view).title).toBe('CLA signature required: 2 unsigned, 2 unlinked');
});

test('the view carries no text, only the summary parts', () => {
  expect(failureReport(requestOf({ evaluation: BOTH, names: NAMES })).view).not.toHaveProperty('text');
});

test('with no active CLA there is nothing to sign and nothing to link: one sentence, no list, no sign link, and the title has no count', () => {
  const evaluation = evaluationOf({
    failureCodes: ['no_active_cla'],
    actors: [actor(11, ['opener']), actor(12)],
    findings: [finding(5, 'Jane Doe')],
  });
  const output = renderCheckOutput(failureReport(requestOf({ evaluation, names: NAMES })).view);
  expect(output.title).toBe('CLA check failed');
  expect(output.summary).toBe(
    [
      'This repository has no active CLA yet, so there is nothing to sign. The maintainers need to publish one.',
      CLOSING,
    ].join('\n\n'),
  );
});

test('a pull request with too many commits is told to split, and an unsigned opener is still listed', () => {
  const evaluation = evaluationOf({
    failureCodes: ['commit_limit_exceeded', 'unsigned_contributor'],
    actors: [actor(11, ['opener'])],
  });
  const output = renderCheckOutput(failureReport(requestOf({ evaluation, names: NAMES })).view);
  expect(output.title).toBe('CLA signature required: 1 unsigned');
  expect(output.summary.split('\n\n')).toEqual([
    SIGN_LINK,
    '### Not signed (1)',
    '- `octocat` (GitHub id 11): opened the PR',
    'This pull request has more commits than the check can read. Split it into smaller pull requests.',
    CLOSING,
  ]);
});

test('a failure with no one to name, no commit to list and no notice is just the closing line', () => {
  expect(summaryOf(requestOf({ evaluation: evaluationOf() }))).toBe(CLOSING);
});

test('the sign link is validated when it is due: a pull request number of 0 or a bad base URL is an error, not a broken link', () => {
  expect(() => summaryOf(requestOf({ evaluation: UNSIGNED, prNumber: 0 }))).toThrow(InvalidSignLinkError);
  expect(() => summaryOf(requestOf({ evaluation: UNSIGNED, githubRepoId: -1 }))).toThrow(InvalidSignLinkError);
  expect(() => summaryOf(requestOf({ evaluation: UNSIGNED, publicBaseUrl: 'https://x.test/' }))).toThrow(
    InvalidSignLinkError,
  );
});

test('when no one is unsigned the link is not built, so the numbers it would need are not checked', () => {
  expect(summaryOf(requestOf({ evaluation: UNLINKED, prNumber: 0, publicBaseUrl: 'nonsense' }))).toContain(
    'How to fix',
  );
});

test('a SHA that is not a full commit SHA, and an id that is not a safe integer, are errors', () => {
  const badSha = evaluationOf({ findings: [{ ...finding(5, 'A'), sha: 'abc' }] });
  expect(() => summaryOf(requestOf({ evaluation: badSha }))).toThrow(InvalidShaError);
  const badId = evaluationOf({ actors: [actor(Number.MAX_SAFE_INTEGER + 1)] });
  expect(() => summaryOf(requestOf({ evaluation: badId }))).toThrow(InvalidIdError);
});

test('the report reads the evaluation and the names and changes neither', () => {
  const request = requestOf({ evaluation: BOTH, names: NAMES });
  const before = structuredClone({ evaluation: request.evaluation, logins: [...NAMES.logins] });
  failureReport(request);
  expect({ evaluation: request.evaluation, logins: [...NAMES.logins] }).toEqual(before);
  expect(NO_NAMES.logins.size).toBe(0);
});
