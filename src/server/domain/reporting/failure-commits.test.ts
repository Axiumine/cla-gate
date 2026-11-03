// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { InvalidShaError } from './encode.ts';
import { unlinkedCommits } from './failure-commits.ts';
import { overrideLine } from './failure-text.ts';
import { finding, sha } from './test-support.ts';

// E09-S03, the `Email not linked to a GitHub account` section: one entry per commit with an unlinked identity that no
// override waives, the name git recorded and never the address, and one line for the commits an override covers.

const TAIL = '(email not linked to a GitHub account)';
const ZERO = '\u200B';

test('a commit is ``- commit `a1b2c3d`: authored as `Jane Doe` (email not linked to a GitHub account)``', () => {
  const commits = unlinkedCommits([
    { sha: 'a1b2c3d4e5f6071829304a5b6c7d8e9f01234567', role: 'author', raw: { name: 'Jane Doe' }, overrideId: null },
  ]);
  expect(commits.entries).toEqual([`- commit \`a1b2c3d\`: authored as \`Jane Doe\` ${TAIL}`]);
  expect(commits.count).toBe(1);
  expect(commits.overridden).toBe(0);
});

test('an unlinked committer is committed as, and a commit with both unlinked is one entry that says both', () => {
  const commits = unlinkedCommits([
    finding(1, 'Pat Committer', 'committer'),
    finding(2, 'Jane Doe', 'author'),
    finding(2, 'Pat Committer', 'committer'),
  ]);
  expect(commits.entries).toEqual([
    `- commit \`0000001\`: committed as \`Pat Committer\` ${TAIL}`,
    `- commit \`0000002\`: authored as \`Jane Doe\`, committed as \`Pat Committer\` ${TAIL}`,
  ]);
  expect(commits.count).toBe(2);
});

test('the author is named before the committer whichever finding comes first', () => {
  const [entry] = unlinkedCommits([finding(2, 'C', 'committer'), finding(2, 'A', 'author')]).entries;
  expect(entry).toBe(`- commit \`0000002\`: authored as \`A\`, committed as \`C\` ${TAIL}`);
});

test('the entries keep the order of the findings, which the engine sorts by commit', () => {
  const commits = unlinkedCommits([finding(3, 'c'), finding(1, 'a'), finding(2, 'b')]);
  expect(commits.entries.map((entry) => entry.slice(10, 17))).toEqual(['0000003', '0000001', '0000002']);
});

test('a commit with an override is not listed and is counted once, however many of its identities are waived', () => {
  const commits = unlinkedCommits([
    finding(1, 'A', 'author', 77),
    finding(1, 'A', 'committer', 77),
    finding(2, 'B', 'author', 78),
    finding(3, 'C'),
  ]);
  expect(commits.entries).toEqual([`- commit \`0000003\`: authored as \`C\` ${TAIL}`]);
  expect(commits.count).toBe(1);
  expect(commits.overridden).toBe(2);
});

test('when every unlinked commit is waived nothing is listed and the count is still stated', () => {
  expect(unlinkedCommits([finding(1, 'A', 'author', 5)])).toEqual({ entries: [], count: 0, overridden: 1 });
});

test('no finding gives no entry and no count', () => {
  expect(unlinkedCommits([])).toEqual({ entries: [], count: 0, overridden: 0 });
});

test('a SHA is compared and shown in lower case', () => {
  const upper = { ...finding(1, 'A'), sha: sha(10).toUpperCase() };
  const lower = { ...finding(1, 'B', 'committer'), sha: sha(10) };
  expect(unlinkedCommits([upper, lower]).entries).toEqual([
    `- commit \`000000a\`: authored as \`A\`, committed as \`B\` ${TAIL}`,
  ]);
});

test('a SHA that is not a full commit SHA is an error, never a shortened guess', () => {
  expect(() => unlinkedCommits([{ ...finding(1, 'A'), sha: 'a1b2c3d' }])).toThrow(InvalidShaError);
});

test('the name is a code span and nothing else: a fence (padded, as the name starts with a backtick), a mention and a tag stay inert', () => {
  const [entry] = unlinkedCommits([finding(1, '`` @everyone <b>')]).entries;
  expect(entry).toBe(`- commit \`0000001\`: authored as \`\`\` \`\` @${ZERO}everyone <b> \`\`\` ${TAIL}`);
});

test.each([
  [1, '1 commit with an email not linked to a GitHub account is covered by a maintainer override.'],
  [2, '2 commits with an email not linked to a GitHub account are covered by a maintainer override.'],
  [250, '250 commits with an email not linked to a GitHub account are covered by a maintainer override.'],
])('the line about %i overridden commits states the number and names no commit', (count, text) => {
  expect(overrideLine(count)).toEqual({ kind: 'text', text });
});
