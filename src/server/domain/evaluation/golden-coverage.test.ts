// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  account,
  allowlistEntry,
  coAuthoredBy,
  commitFacts,
  evaluationInput,
  membership,
  messageEndingWith,
  noreplyEmail,
  signatureFact,
  verdictLines,
} from './test-support.ts';

// E08-S08, golden scenarios about who is covered and by what. Each snapshot is the stored details plus the fixes, so a
// change to any rule shows up here as a reviewable diff. Signature ids are the user id times ten; the policy is document 1
// at major 1; user 1 opens the pull request and users 2 and 3 write the commits unless a scenario says otherwise.

const signedBy = (...ids: readonly number[]) => ids.map((id) => signatureFact(id * 10, id));

test('golden: the opener and every author signed', () => {
  const input = evaluationInput({ commits: [commitFacts(2), commitFacts(3)], signatures: signedBy(1, 2, 3) });
  expect(verdictLines(input)).toMatchInlineSnapshot(`
    [
      "success: no failure code",
      "document 1, major 1, listing complete",
      "2 commits, 0 merge commits skipped",
      "actor 1 opener: covered by signature 10 (version 1010, major 1)",
      "actor 2 author: covered by signature 20 (version 1020, major 1)",
      "actor 3 author: covered by signature 30 (version 1030, major 1)",
    ]
  `);
});

test('golden: an unsigned author', () => {
  const input = evaluationInput({ commits: [commitFacts(2), commitFacts(3)], signatures: signedBy(1, 2) });
  expect(verdictLines(input)).toMatchInlineSnapshot(`
    [
      "failure: unsigned_contributor",
      "document 1, major 1, listing complete",
      "2 commits, 0 merge commits skipped",
      "actor 1 opener: covered by signature 10 (version 1010, major 1)",
      "actor 2 author: covered by signature 20 (version 1020, major 1)",
      "actor 3 author: uncovered",
      "fix sign_cla 3",
    ]
  `);
});

test('golden: an unsigned opener with signed authors', () => {
  const input = evaluationInput({ commits: [commitFacts(2), commitFacts(3)], signatures: signedBy(2, 3) });
  expect(verdictLines(input)).toMatchInlineSnapshot(`
    [
      "failure: unsigned_contributor",
      "document 1, major 1, listing complete",
      "2 commits, 0 merge commits skipped",
      "actor 1 opener: uncovered",
      "actor 2 author: covered by signature 20 (version 1020, major 1)",
      "actor 3 author: covered by signature 30 (version 1030, major 1)",
      "fix sign_cla 1",
    ]
  `);
});

test('golden: the attacker, an unsigned opener whose commits use a signer noreply identity, fails', () => {
  const signer = account(2);
  const input = evaluationInput({
    opener: account(99),
    commits: [
      commitFacts(10, {
        author: signer,
        committer: signer,
        message: messageEndingWith(coAuthoredBy(noreplyEmail(2, 'signer'), 'Signer')),
      }),
    ],
    signatures: signedBy(2),
  });
  expect(verdictLines(input)).toMatchInlineSnapshot(`
    [
      "failure: unsigned_contributor",
      "document 1, major 1, listing complete",
      "1 commits, 0 merge commits skipped",
      "actor 2 author+co_author: covered by signature 20 (version 1020, major 1)",
      "actor 99 opener: uncovered",
      "fix sign_cla 99",
    ]
  `);
});

test('golden: a bot opener that is not on the allowlist', () => {
  const input = evaluationInput({ opener: account(500, 'Bot'), allowlist: [allowlistEntry(1, 'user', 500)] });
  expect(verdictLines(input)).toMatchInlineSnapshot(`
    [
      "failure: bot_not_allowlisted",
      "document 1, major 1, listing complete",
      "0 commits, 0 merge commits skipped",
      "actor 500 opener: uncovered",
      "fix allowlist_bot 500",
    ]
  `);
});

test('golden: a bot opener on the allowlist', () => {
  const input = evaluationInput({ opener: account(500, 'Bot'), allowlist: [allowlistEntry(7, 'bot', 500)] });
  expect(verdictLines(input)).toMatchInlineSnapshot(`
    [
      "success: no failure code",
      "document 1, major 1, listing complete",
      "0 commits, 0 merge commits skipped",
      "actor 500 opener: covered by allowlist entry 7 (bot, repository)",
    ]
  `);
});

test('golden: an organisation member who never signed is covered by the membership', () => {
  const input = evaluationInput({
    commits: [commitFacts(2)],
    signatures: signedBy(1),
    allowlist: [allowlistEntry(3, 'org_members', 700, 'installation')],
    orgMembers: membership([700, [2]]),
  });
  expect(verdictLines(input)).toMatchInlineSnapshot(`
    [
      "success: no failure code",
      "document 1, major 1, listing complete",
      "1 commits, 0 merge commits skipped",
      "actor 1 opener: covered by signature 10 (version 1010, major 1)",
      "actor 2 author: covered by allowlist entry 3 (org_members, installation)",
    ]
  `);
});

test('golden: an unsigned third-party committer', () => {
  const input = evaluationInput({
    commits: [commitFacts(2, { committer: account(8) })],
    signatures: signedBy(1, 2),
  });
  expect(verdictLines(input)).toMatchInlineSnapshot(`
    [
      "failure: unsigned_contributor",
      "document 1, major 1, listing complete",
      "1 commits, 0 merge commits skipped",
      "actor 1 opener: covered by signature 10 (version 1010, major 1)",
      "actor 2 author: covered by signature 20 (version 1020, major 1)",
      "actor 8 committer: uncovered",
      "fix sign_cla 8",
    ]
  `);
});

test('golden: a major bump, signed v1 while v2 is active', () => {
  const input = evaluationInput({
    policy: { documentId: 1, activeMajor: 2 },
    commits: [commitFacts(2)],
    signatures: signedBy(1, 2),
  });
  expect(verdictLines(input)).toMatchInlineSnapshot(`
    [
      "failure: unsigned_contributor",
      "document 1, major 2, listing complete",
      "1 commits, 0 merge commits skipped",
      "actor 1 opener: uncovered",
      "actor 2 author: uncovered",
      "fix sign_cla 1",
      "fix sign_cla 2",
    ]
  `);
});

test('golden: after the major bump the signers of v2 pass again', () => {
  const input = evaluationInput({
    policy: { documentId: 1, activeMajor: 2 },
    commits: [commitFacts(2)],
    signatures: [signatureFact(11, 1, { major: 2 }), signatureFact(12, 2, { major: 2 })],
  });
  expect(verdictLines(input)).toMatchInlineSnapshot(`
    [
      "success: no failure code",
      "document 1, major 2, listing complete",
      "1 commits, 0 merge commits skipped",
      "actor 1 opener: covered by signature 11 (version 1011, major 2)",
      "actor 2 author: covered by signature 12 (version 1012, major 2)",
    ]
  `);
});
