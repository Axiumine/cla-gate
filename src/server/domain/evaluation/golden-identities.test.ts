// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { GITHUB_WEB_FLOW_ID } from './github-identities.ts';
import {
  account,
  coAuthoredBy,
  commitFacts,
  evaluationInput,
  messageEndingWith,
  noreplyEmail,
  sha,
  signatureFact,
  verdictLines,
} from './test-support.ts';

// E08-S08, golden scenarios about identities and limits: unlinked authors, the web-flow committer, merge commits,
// trailers, an exceeded listing and a repository without a CLA. Signature ids are the user id times ten; the policy is
// document 1 at major 1; user 1 opens the pull request and signed, and so did user 2, unless a scenario says otherwise.

const signed = [signatureFact(10, 1), signatureFact(20, 2)];

test('golden: an unlinked author without an override', () => {
  const input = evaluationInput({ commits: [commitFacts(2, { author: null, committer: null })], signatures: signed });
  expect(verdictLines(input)).toMatchInlineSnapshot(`
    [
      "failure: unlinked_identity",
      "document 1, major 1, listing complete",
      "1 commits, 0 merge commits skipped",
      "actor 1 opener: covered by signature 10 (version 1010, major 1)",
      "unlinked 2 author: open",
      "unlinked 2 committer: open",
      "fix link_commit_email 2 author",
      "fix link_commit_email 2 committer",
      "fix maintainer_override 2",
    ]
  `);
});

test('golden: an unlinked author with an override on the commit', () => {
  const input = evaluationInput({
    commits: [commitFacts(2, { author: null, committer: null })],
    signatures: signed,
    overrides: new Map([[sha(2), 55]]),
  });
  expect(verdictLines(input)).toMatchInlineSnapshot(`
    [
      "success: no failure code",
      "document 1, major 1, listing complete",
      "1 commits, 0 merge commits skipped",
      "actor 1 opener: covered by signature 10 (version 1010, major 1)",
      "unlinked 2 author: override 55",
      "unlinked 2 committer: override 55",
    ]
  `);
});

test('golden: a web-flow committer is exempt and the author is the one to cover', () => {
  const input = evaluationInput({
    commits: [commitFacts(2, { committer: account(GITHUB_WEB_FLOW_ID) })],
    signatures: signed,
  });
  expect(verdictLines(input)).toMatchInlineSnapshot(`
    [
      "success: no failure code",
      "document 1, major 1, listing complete",
      "1 commits, 0 merge commits skipped",
      "actor 1 opener: covered by signature 10 (version 1010, major 1)",
      "actor 2 author: covered by signature 20 (version 1020, major 1)",
    ]
  `);
});

test('golden: a merge commit by unsigned people is skipped', () => {
  const input = evaluationInput({
    commits: [commitFacts(2), commitFacts(9, { parents: [sha(2), sha(8)] })],
    signatures: signed,
  });
  expect(verdictLines(input)).toMatchInlineSnapshot(`
    [
      "success: no failure code",
      "document 1, major 1, listing complete",
      "2 commits, 1 merge commits skipped",
      "actor 1 opener: covered by signature 10 (version 1010, major 1)",
      "actor 2 author: covered by signature 20 (version 1020, major 1)",
    ]
  `);
});

test('golden: a co-author resolved from a trailer who has not signed', () => {
  const input = evaluationInput({
    commits: [commitFacts(2, { message: messageEndingWith(coAuthoredBy(noreplyEmail(40, 'pairing'), 'Pairing')) })],
    signatures: signed,
  });
  expect(verdictLines(input)).toMatchInlineSnapshot(`
    [
      "failure: unsigned_contributor",
      "document 1, major 1, listing complete",
      "1 commits, 0 merge commits skipped",
      "actor 1 opener: covered by signature 10 (version 1010, major 1)",
      "actor 2 author: covered by signature 20 (version 1020, major 1)",
      "actor 40 co_author: uncovered",
      "fix sign_cla 40",
    ]
  `);
});

test('golden: a trailer that cannot be resolved is an advisory and does not block', () => {
  const input = evaluationInput({
    commits: [commitFacts(2, { message: messageEndingWith(coAuthoredBy('pairing@example.org')) })],
    signatures: signed,
  });
  expect(verdictLines(input)).toMatchInlineSnapshot(`
    [
      "success: no failure code",
      "document 1, major 1, listing complete",
      "1 commits, 0 merge commits skipped",
      "actor 1 opener: covered by signature 10 (version 1010, major 1)",
      "actor 2 author: covered by signature 20 (version 1020, major 1)",
      "advisory co_author_unresolved 2",
    ]
  `);
});

test('golden: an exceeded listing fails closed and asks for a split', () => {
  const input = evaluationInput({ listing: 'exceeded', commits: [commitFacts(2)], signatures: signed });
  expect(verdictLines(input)).toMatchInlineSnapshot(`
    [
      "failure: commit_limit_exceeded",
      "document 1, major 1, listing exceeded",
      "0 commits, 0 merge commits skipped",
      "actor 1 opener: covered by signature 10 (version 1010, major 1)",
      "fix split_pull_request",
    ]
  `);
});

test('golden: no active CLA', () => {
  const input = evaluationInput({ policy: null, commits: [commitFacts(2)], signatures: signed });
  expect(verdictLines(input)).toMatchInlineSnapshot(`
    [
      "failure: no_active_cla",
      "document null, major null, listing complete",
      "1 commits, 0 merge commits skipped",
      "actor 1 opener: uncovered",
      "actor 2 author: uncovered",
    ]
  `);
});
