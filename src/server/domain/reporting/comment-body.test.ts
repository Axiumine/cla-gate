// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { COMMENT_MARKER, commentBody, disabledCommentBody } from './comment-body.ts';
import { InvalidShaError } from './encode.ts';
import { failureReport } from './failure-report.ts';
import { MAX_OUTPUT_UNITS, type OutputPart, OutputTooLongError } from './output-parts.ts';
import { actor, evaluationOf, finding, HEAD, requestOf, sha } from './test-support.ts';

// E09-S06, E09-S07: the comment of the platform is the marker line and then what the evaluation found: the one-line notice of a
// repository whose enforcement is off, the failure report under a heading and a line that names the check, or the sentence that
// the contributors have signed. The marker is the first line and appears once.

const CLOSING = 'After fixing, comment `/recheck` or use Re-run. `/recheck` can be used once per minute.';
const CHECK_LINE = 'This comment is rewritten on every evaluation of the `license/cla` check.';
const NAMES = { logins: new Map([[11, 'octocat']]), coAuthors: new Map<string, string[]>() };

/** The comment of the failure report of `request`. */
const failureComment = (request: Parameters<typeof failureReport>[0]): string =>
  commentBody({ kind: 'failure', summary: failureReport(request).view.summary });

test('the marker is the fixed line that names the check and the version', () => {
  expect(COMMENT_MARKER).toBe('<!-- cla-platform:license/cla:v1 -->');
});

test('the disabled body is the marker line, then the one-line notice, and holds the marker once', () => {
  const body = disabledCommentBody();
  expect(body).toBe('<!-- cla-platform:license/cla:v1 -->\nCLA enforcement is disabled for this repository.');
  expect(body.split(COMMENT_MARKER)).toHaveLength(2);
  expect(body.split('\n')).toHaveLength(2);
});

test('the success body is the marker line and the sentence with the short SHA of the head, and holds the marker once', () => {
  const body = commentBody({ kind: 'success', headSha: HEAD });
  expect(body).toBe('<!-- cla-platform:license/cla:v1 -->\nAll contributors have signed the CLA for commit 1a2b3c4.');
  expect(body.split(COMMENT_MARKER)).toHaveLength(2);
});

test.each(['1a2b3c4', 'main', HEAD.toUpperCase(), ''])(
  'the success body for the head %j that is not a full SHA is refused',
  (head) => {
    expect(() => commentBody({ kind: 'success', headSha: head })).toThrow(InvalidShaError);
  },
);

test('the failure body is the marker, the heading, the sign link, the sections, the closing line and the line that names the check', () => {
  const evaluation = evaluationOf({
    failureCodes: ['unlinked_identity', 'unsigned_contributor'],
    actors: [actor(11, ['opener', 'author'])],
    findings: [finding(5, 'Jane Doe')],
  });
  expect(failureComment(requestOf({ evaluation, names: NAMES }))).toMatchInlineSnapshot(`
    "<!-- cla-platform:license/cla:v1 -->
    ## CLA check failed

    [Sign the CLA](https://cla.example.test/sign/4242?pr=7)

    ### Not signed (1)

    - \`octocat\` (GitHub id 11): opened the PR, commit author

    ### Email not linked to a GitHub account (1)

    - commit \`0000005\`: authored as \`Jane Doe\` (email not linked to a GitHub account)

    ### How to fix

    Read the email of a commit with \`git log -1 --format=%ae <sha>\`.

    1. Add and verify the commit email at https://github.com/settings/emails.
    2. Or set a linked address and rewrite the commits with \`git config user.email "<linked email>"\`, \`git rebase <base> --exec 'git commit --amend --reset-author --no-edit'\` and \`git push --force-with-lease\`.
    3. Or ask a maintainer to record an exception for the listed commits (an exception never counts as a signature).

    After fixing, comment \`/recheck\` or use Re-run. \`/recheck\` can be used once per minute.

    This comment is rewritten on every evaluation of the \`license/cla\` check."
  `);
});

test('the failure body starts with the marker line, holds it once and ends with the line that names the check', () => {
  const body = failureComment(requestOf({ evaluation: evaluationOf({ actors: [actor(11)] }), names: NAMES }));
  expect(body.startsWith(`${COMMENT_MARKER}\n## CLA check failed\n\n`)).toBe(true);
  expect(body.split(COMMENT_MARKER)).toHaveLength(2);
  expect(body.endsWith(`\n\n${CLOSING}\n\n${CHECK_LINE}`)).toBe(true);
});

test('a failure with no active CLA has no sign link and no list, and keeps the heading, its sentence and the closing lines', () => {
  const evaluation = evaluationOf({ failureCodes: ['no_active_cla'] });
  expect(failureComment(requestOf({ evaluation }))).toBe(
    [
      COMMENT_MARKER,
      '## CLA check failed',
      '',
      'This repository has no active CLA yet, so there is nothing to sign. The maintainers need to publish one.',
      '',
      CLOSING,
      '',
      CHECK_LINE,
    ].join('\n'),
  );
});

test('a failure body with no part at all is the marker, the heading and the line that names the check', () => {
  expect(commentBody({ kind: 'failure', summary: [] })).toBe(`${COMMENT_MARKER}\n## CLA check failed\n\n${CHECK_LINE}`);
});

test('a failure with 10 000 unsigned people lists 50 of them, ends with the visible truncation line, and keeps the closing lines', () => {
  const evaluation = evaluationOf({
    actors: Array.from({ length: 10_000 }, (_, index) => actor(index + 1, ['opener', 'author'])),
  });
  const body = failureComment(requestOf({ evaluation }));
  const lines = body.split('\n');
  expect(lines.filter((line) => line.startsWith('- `'))).toHaveLength(50);
  expect(lines).toContain('…and 9950 more (list truncated)');
  const last = lines.findLastIndex((line) => line.startsWith('- `'));
  expect(lines.slice(last + 1, last + 3)).toEqual(['', '…and 9950 more (list truncated)']);
  expect(body.endsWith(`${CLOSING}\n\n${CHECK_LINE}`)).toBe(true);
  expect(body.length).toBeLessThanOrEqual(MAX_OUTPUT_UNITS);
});

test('a body that would pass 60 000 UTF-16 code units loses whole entries from the end of its list and says so', () => {
  const entries = Array.from(
    { length: 50 },
    (_, index) => `- entry ${String(index).padStart(2, '0')} ${'x'.repeat(190)}`,
  );
  const summary: OutputPart[] = [
    { kind: 'text', text: 'y'.repeat(58_000) },
    { kind: 'list', entries },
  ];
  const body = commentBody({ kind: 'failure', summary });
  const lines = body.split('\n');
  expect(body.length).toBeLessThanOrEqual(MAX_OUTPUT_UNITS);
  const shown = lines.filter((line) => line.startsWith('- entry '));
  expect(shown.length).toBeGreaterThan(0);
  expect(shown.length).toBeLessThan(50);
  expect(shown.every((line) => line.length === entries[0]?.length)).toBe(true);
  expect(lines).toContain(`…and ${50 - shown.length} more (list truncated)`);
  expect(lines[0]).toBe(COMMENT_MARKER);
  expect(body.endsWith(CHECK_LINE)).toBe(true);
});

test('fixed text that alone does not fit the limit is a defect, not a cut', () => {
  expect(() =>
    commentBody({ kind: 'failure', summary: [{ kind: 'text', text: 'z'.repeat(MAX_OUTPUT_UNITS) }] }),
  ).toThrow(OutputTooLongError);
});

test('the failure body names the unlinked commit by its short SHA and prints no email address', () => {
  const evaluation = evaluationOf({ failureCodes: ['unlinked_identity'], findings: [finding(5, 'Jane Doe')] });
  const body = failureComment(requestOf({ evaluation }));
  expect(body).toContain(`commit \`${sha(5).slice(0, 7)}\``);
  expect(body).not.toContain('@');
});
