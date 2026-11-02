// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import { AUDIT_METADATA_KEYS } from './audit.ts';
import type { PrEvaluationDetails } from './pr-evaluation-details.ts';

/**
 * A stored evaluation that uses every field: both covering bases, an actor with several roles, an uncovered co-author,
 * an overridden and a plain unlinked finding, and an advisory. Ids and SHAs are made up. A fresh object on every call, so
 * a test can change it freely.
 */
export function storedDetailsSample(): PrEvaluationDetails {
  return {
    version: 1,
    outcome: 'failure',
    failureCodes: ['unlinked_identity', 'unsigned_contributor'],
    documentId: 12,
    activeMajor: 2,
    commitCount: 3,
    mergeCommitsSkipped: 1,
    listing: 'complete',
    actors: [
      {
        githubId: 1001,
        roles: ['opener', 'author'],
        covered: true,
        basis: { kind: 'signature', signatureId: 31, versionId: 7, major: 2 },
      },
      {
        githubId: 1002,
        roles: ['committer'],
        covered: true,
        basis: { kind: 'allowlist', entryId: 4, entryKind: 'org_members', scope: 'installation' },
      },
      { githubId: 1003, roles: ['co_author'], covered: false, basis: null },
    ],
    unlinked: [
      { sha: 'a'.repeat(40), role: 'author', overrideId: null },
      { sha: 'b'.repeat(64), role: 'committer', overrideId: 55 },
    ],
    advisories: [{ code: 'co_author_unresolved', sha: 'c'.repeat(40) }],
  };
}

/** `[name, metadata, accepted]`: one table that both the zod schema and the database check must agree with (E04-S09). */
export type MetadataCase = readonly [name: string, metadata: unknown, accepted: boolean];

const codeOf = (length: number): string => 'a'.repeat(length);

export const METADATA_CASES: readonly MetadataCase[] = [
  ['nothing at all', {}, true],
  ['an integer', { count: 3 }, true],
  ['zero and a negative integer', { count: 0, minor: -1 }, true],
  ['booleans and null', { enabled: false, pr_number: null }, true],
  ['a code with digits and punctuation', { state: 'a.b:c-d_e9' }, true],
  ['a code that starts with a digit', { scope: '7up' }, true],
  ['a commit SHA', { commit_sha: 'f'.repeat(40) }, true],
  ['a SHA-256 digest', { commit_sha: '0'.repeat(64) }, true],
  ['a code of 64 characters', { kind: codeOf(64) }, true],
  ['a dotted version with three numbers', { revision: '1.2.3' }, true],
  ['a dotted name that is not four numbers', { kind: 'a.b.c.d' }, true],
  ['four numbers of which one has four digits', { kind: '1234.5.6.7' }, true],
  ['five numbers with dots', { kind: '1.2.3.4.5' }, true],
  ['a code with one colon', { scope: 'org:member' }, true],
  // Mutation testing (E20-S04): each of these tells apart an address check from the same check with one anchor or one
  // digit-count dropped. The database check (migration 002) judges them the same way.
  ['hex digits around a single colon, which is no IPv6 address', { scope: 'dead:beef' }, true],
  ['an IPv4 address with a port and trailing text', { scope: '1.2.3.4:5x' }, true],
  ['an IPv4 address with a port and leading text', { scope: 'x1.2.3.4:5' }, true],
  ['two colons after text, which is no IPv6 address', { state: 'xyz:a:b' }, true],
  ['two colons before text, which is no IPv6 address', { state: 'a:b:xyz' }, true],
  ['a list of integers', { rows: [1, 2, 3] }, true],
  ['an empty list', { rows: [] }, true],
  ['a list of 100 integers', { rows: Array.from({ length: 100 }, (_, index) => index) }, true],
  ['every key of the closed list', Object.fromEntries(AUDIT_METADATA_KEYS.map((key) => [key, 1])), true],
  ['a fraction', { count: 1.5 }, false],
  ['an empty code', { kind: '' }, false],
  ['a code of 65 characters', { kind: codeOf(65) }, false],
  ['a code in upper case', { kind: 'Individual' }, false],
  ['a code with a space', { kind: 'two words' }, false],
  ['an e-mail address in a code', { reason_code: 'alice@example.com' }, false],
  ['an IPv4 address', { kind: '203.0.113.7' }, false],
  ['an IPv4 address under another key', { state: '198.51.100.9' }, false],
  ['an IPv4 address with a port', { scope: '203.0.113.7:8080' }, false],
  ['an IPv4 address whose last number has three digits', { kind: '203.0.113.255' }, false],
  ['an IPv4 address of three-digit numbers with a five-digit port', { scope: '203.113.113.255:65535' }, false],
  ['an IPv6 address', { kind: '2001:db8::1' }, false],
  ['an IPv6 address with a group after the gap', { state: '2001:db8:0:1::5' }, false],
  ['the IPv6 loopback address', { kind: '::1' }, false],
  ['an IPv6 address written in full', { scope: '2001:db8:0:0:0:0:0:1' }, false],
  ['an IPv6 address that ends in an IPv4 address', { reason_code: '2001:db8::203.0.113.7' }, false],
  ['a code with a trailing newline', { kind: 'individual\n' }, false],
  ['a code with a letter outside ASCII', { kind: 'café' }, false],
  ['a list of 101 integers', { rows: Array.from({ length: 101 }, (_, index) => index) }, false],
  ['a list of strings', { rows: ['a'] }, false],
  ['a list holding null', { rows: [null] }, false],
  ['a list holding a fraction', { rows: [1.5] }, false],
  ['a nested list', { rows: [[1]] }, false],
  ['an object as a value', { count: { n: 1 } }, false],
  ['a name', { name: 'Alice' }, false],
  ['an e-mail address as a key', { email: 'alice@example.com' }, false],
  ['a login', { login: 'alice' }, false],
  ['an avatar URL', { avatar_url: 'https://avatars.example/u' }, false],
  ['free text under reason', { reason: 'because' }, false],
  ['free text under message', { message: 'hello' }, false],
  ['free text under title', { title: 'hello' }, false],
  ['free text under text', { text: 'hello' }, false],
  ['a key that is not listed', { foo: 1 }, false],
  ['a listed key in capitals', { Count: 1 }, false],
  ['a key that merely contains a listed one', { source_count: 1 }, false],
  ['a key that merely starts with a personal word', { username: 'alice' }, false],
  ['a list instead of an object', [], false],
  ['null instead of an object', null, false],
  ['a string instead of an object', 'count', false],
];
