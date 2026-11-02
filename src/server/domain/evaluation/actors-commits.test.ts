// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { extractActors } from './actors.ts';
import { GITHUB_WEB_FLOW_ID } from './github-identities.ts';
import { account, actorRows, commitFacts, evaluationInput, sha } from './test-support.ts';

// E08-S02: the committer exemptions and the unlinked findings. The opener is user 1 in every row and is not the subject.

const OPENER_ONLY = { id: 1, roles: ['opener'], shas: [] } as const;

test.each([
  [
    'committer equals author: only the author is an actor',
    commitFacts(2, { committer: account(2) }),
    [{ id: 2, roles: ['author'], shas: [sha(2)] }],
  ],
  [
    'committer is the web-flow id: only the author is an actor',
    commitFacts(2, { committer: account(GITHUB_WEB_FLOW_ID) }),
    [{ id: 2, roles: ['author'], shas: [sha(2)] }],
  ],
  [
    'committer is the web-flow id and the type is not User: still exempt, by id',
    commitFacts(2, { committer: account(GITHUB_WEB_FLOW_ID, 'Bot') }),
    [{ id: 2, roles: ['author'], shas: [sha(2)] }],
  ],
  [
    'a third-party committer is an actor with the role committer',
    commitFacts(2, { committer: account(7) }),
    [
      { id: 2, roles: ['author'], shas: [sha(2)] },
      { id: 7, roles: ['committer'], shas: [sha(2)] },
    ],
  ],
  [
    'a committer that merely says web-flow (app slug) with another id is not exempt',
    commitFacts(2, { committer: { id: GITHUB_WEB_FLOW_ID + 1, type: 'User', appSlug: 'web-flow' } }),
    [
      { id: 2, roles: ['author'], shas: [sha(2)] },
      { id: GITHUB_WEB_FLOW_ID + 1, roles: ['committer'], shas: [sha(2)] },
    ],
  ],
  [
    'an id one below the web-flow id is not exempt either',
    commitFacts(2, { committer: account(GITHUB_WEB_FLOW_ID - 1) }),
    [
      { id: 2, roles: ['author'], shas: [sha(2)] },
      { id: GITHUB_WEB_FLOW_ID - 1, roles: ['committer'], shas: [sha(2)] },
    ],
  ],
  [
    'web-flow as the author is not exempt: only the committer role is',
    commitFacts(2, { author: account(GITHUB_WEB_FLOW_ID), committer: account(GITHUB_WEB_FLOW_ID) }),
    [{ id: GITHUB_WEB_FLOW_ID, roles: ['author'], shas: [sha(2)] }],
  ],
  [
    'an unlinked author does not make the web-flow committer an actor',
    commitFacts(2, { author: null, committer: account(GITHUB_WEB_FLOW_ID) }),
    [],
  ],
  [
    'an unlinked author and a linked committer: the committer is not compared with a missing author',
    commitFacts(2, { author: null, committer: account(7) }),
    [{ id: 7, roles: ['committer'], shas: [sha(2)] }],
  ],
])('%s', (_name, commit, others) => {
  const extraction = extractActors(evaluationInput({ commits: [commit] }));
  const rest = actorRows(extraction).filter((row) => row.id !== 1);
  expect(rest).toEqual(others);
  expect(actorRows(extraction).find((row) => row.id === 1)).toEqual(OPENER_ONLY);
});

test.each([
  ['an unlinked author', commitFacts(2, { author: null }), [{ sha: sha(2), role: 'author' }], [1, 2]],
  [
    'an unlinked committer with a linked author',
    commitFacts(2, { committer: null }),
    [{ sha: sha(2), role: 'committer' }],
    [1, 2],
  ],
  [
    'both unlinked: two findings, author first',
    commitFacts(2, { author: null, committer: null }),
    [
      { sha: sha(2), role: 'author' },
      { sha: sha(2), role: 'committer' },
    ],
    [1],
  ],
])('%s gives a finding per unlinked identity and no actor for it', (_name, commit, findings, actorIds) => {
  const extraction = extractActors(evaluationInput({ commits: [commit] }));
  expect(extraction.unlinked.map(({ sha: s, role }) => ({ sha: s, role }))).toEqual(findings);
  expect(extraction.actors.map((actor) => actor.account.id)).toEqual(actorIds);
});

test('an unlinked author is no actor at all, and the linked committer of that commit still is', () => {
  const commit = commitFacts(2, { author: null, committer: account(7) });
  const extraction = extractActors(evaluationInput({ commits: [commit] }));
  expect(extraction.actors.map((actor) => actor.account.id)).toEqual([1, 7]);
});

test('a finding carries the display-only raw identity of the role it is about, and only that one', () => {
  const commit = commitFacts(2, {
    author: null,
    committer: null,
    rawAuthor: { name: 'Ada Author', email: 'ada@example.org' },
    rawCommitter: { name: 'Carl Committer', email: 'carl@example.org' },
  });
  const { unlinked } = extractActors(evaluationInput({ commits: [commit] }));
  expect(unlinked).toEqual([
    { sha: sha(2), role: 'author', raw: { name: 'Ada Author', email: 'ada@example.org' } },
    { sha: sha(2), role: 'committer', raw: { name: 'Carl Committer', email: 'carl@example.org' } },
  ]);
});

test('findings are sorted by SHA and then by role, whatever order the commits arrive in', () => {
  const commits = [
    commitFacts(9, { author: null, committer: null }),
    commitFacts(3, { committer: null }),
    commitFacts(5, { author: null }),
  ];
  const { unlinked } = extractActors(evaluationInput({ commits }));
  expect(unlinked.map(({ sha: s, role }) => `${s.slice(-1)}:${role}`)).toEqual([
    '3:committer',
    '5:author',
    '9:author',
    '9:committer',
  ]);
});

test('a root commit and a single-parent commit are both read', () => {
  const root = commitFacts(2, { parents: [] });
  const single = commitFacts(3, { parents: [sha(2)] });
  const extraction = extractActors(evaluationInput({ commits: [root, single] }));
  expect(actorRows(extraction).map((row) => row.id)).toEqual([1, 2, 3]);
  expect(extraction.mergeCommitsSkipped).toBe(0);
});

test.each([
  ['two parents', [sha(10), sha(11)]],
  ['three parents (an octopus merge)', [sha(10), sha(11), sha(12)]],
])('a merge commit with %s is skipped entirely, even when its identities are unlinked', (_name, parents) => {
  const merge = commitFacts(2, { parents, author: null, committer: null });
  const extraction = extractActors(evaluationInput({ commits: [merge] }));
  expect(actorRows(extraction)).toEqual([OPENER_ONLY]);
  expect(extraction.unlinked).toEqual([]);
  expect(extraction.mergeCommitsSkipped).toBe(1);
});

test('a merge commit whose author and committer are both unsigned adds no actor but is counted', () => {
  const merge = commitFacts(2, { parents: [sha(10), sha(11)], author: account(40), committer: account(41) });
  const normal = commitFacts(3);
  const extraction = extractActors(evaluationInput({ commits: [merge, normal] }));
  expect(actorRows(extraction).map((row) => row.id)).toEqual([1, 3]);
  expect(extraction.mergeCommitsSkipped).toBe(1);
});

test('merge commits are counted once per SHA, and an author met only in a merge stays out', () => {
  const merge = commitFacts(2, { parents: [sha(10), sha(11)] });
  const other = commitFacts(4, { parents: [sha(10), sha(11)] });
  const extraction = extractActors(evaluationInput({ commits: [merge, other, merge] }));
  expect(extraction.mergeCommitsSkipped).toBe(2);
  expect(extraction.actors).toHaveLength(1);
});

test('a SHA given in upper case is reported in lower case, and a duplicate by case is one commit', () => {
  const upper = commitFacts(2, { sha: sha(2).toUpperCase(), author: null });
  const lower = commitFacts(2, { author: null });
  const extraction = extractActors(evaluationInput({ commits: [upper, lower, commitFacts(3, { sha: 'ABC123' })] }));
  expect(extraction.unlinked).toHaveLength(1);
  expect(extraction.unlinked[0]?.sha).toBe(sha(2));
  expect(actorRows(extraction).find((row) => row.id === 3)?.shas).toEqual(['abc123']);
});

test('the same commit listed twice gives each actor, SHA and finding once', () => {
  const dup = commitFacts(2, { committer: null });
  const extraction = extractActors(evaluationInput({ commits: [dup, dup] }));
  expect(actorRows(extraction).find((row) => row.id === 2)).toEqual({ id: 2, roles: ['author'], shas: [sha(2)] });
  expect(extraction.unlinked).toHaveLength(1);
});

test('a commit listed twice with conflicting facts is read as both, with the findings still in order', () => {
  const first = commitFacts(2, { author: account(2), committer: null });
  const second = commitFacts(2, { author: null, committer: null });
  const extraction = extractActors(evaluationInput({ commits: [first, second] }));
  expect(extraction.unlinked.map(({ role }) => role)).toEqual(['author', 'committer']);
  expect(actorRows(extraction).map((row) => row.id)).toEqual([1, 2]);
});
