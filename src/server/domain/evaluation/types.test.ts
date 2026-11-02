// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, expectTypeOf, test } from 'vitest';
import type { PrEvaluationDetails } from '../../../shared/pr-evaluation-details.ts';
import { account, commitFacts, evaluationInput, sha } from './test-support.ts';
import {
  ACCOUNT_TYPES,
  type Account,
  ADVISORY_CODES,
  ALLOWLIST_KINDS,
  ALLOWLIST_SCOPES,
  type AllowlistBasis,
  type AllowlistEntry,
  type CommitFacts,
  type CoveringBasis,
  type EvaluationInput,
  FAILURE_CODES,
  FIX_CODES,
  type Policy,
  type RawIdentity,
  ROLES,
  type SignatureBasis,
  type SignatureFact,
} from './types.ts';

// The closed lists are the vocabulary of every later rule and of the stored details. Pinning them means a member cannot
// be added, renamed or reordered without a test (and so a reviewer) noticing.
test.each([
  [
    'FAILURE_CODES',
    FAILURE_CODES,
    ['no_active_cla', 'unsigned_contributor', 'bot_not_allowlisted', 'unlinked_identity', 'commit_limit_exceeded'],
  ],
  ['ROLES', ROLES, ['opener', 'author', 'committer', 'co_author']],
  [
    'FIX_CODES',
    FIX_CODES,
    [
      'sign_cla',
      'allowlist_bot',
      'allowlist_account',
      'link_commit_email',
      'maintainer_override',
      'split_pull_request',
    ],
  ],
  ['ACCOUNT_TYPES', ACCOUNT_TYPES, ['User', 'Bot', 'Organization', 'Mannequin', 'Unknown']],
  ['ADVISORY_CODES', ADVISORY_CODES, ['too_many_trailers', 'co_author_unresolved']],
  ['ALLOWLIST_KINDS, in matching order', ALLOWLIST_KINDS, ['user', 'bot', 'org_members']],
  ['ALLOWLIST_SCOPES', ALLOWLIST_SCOPES, ['installation', 'repository']],
])('%s is exactly the closed list', (_name, actual, expected) => {
  expect(actual).toEqual(expected);
});

test('an account carries an id, a type and a display-only app slug, and no login, name or email', () => {
  expectTypeOf<keyof Account>().toEqualTypeOf<'id' | 'type' | 'appSlug'>();
  expectTypeOf<Account['id']>().toBeNumber();
  expectTypeOf<Account['type']>().toEqualTypeOf<'User' | 'Bot' | 'Organization' | 'Mannequin' | 'Unknown'>();
  expectTypeOf<Account['appSlug']>().toEqualTypeOf<string | undefined>();
  expect(Object.keys(account(7, 'Bot'))).toEqual(['id', 'type']);
});

test('a commit has no personal data except the two display-only raw identities', () => {
  expectTypeOf<keyof CommitFacts>().toEqualTypeOf<
    'sha' | 'parents' | 'author' | 'committer' | 'message' | 'rawAuthor' | 'rawCommitter'
  >();
  expectTypeOf<CommitFacts['author']>().toEqualTypeOf<Account | null>();
  expectTypeOf<CommitFacts['committer']>().toEqualTypeOf<Account | null>();
  expectTypeOf<CommitFacts['rawAuthor']>().toEqualTypeOf<RawIdentity>();
  expectTypeOf<keyof RawIdentity>().toEqualTypeOf<'name' | 'email'>();
  expectTypeOf<CommitFacts['parents']>().toEqualTypeOf<readonly string[]>();
});

test('the input is readonly data: lists, a membership map and an override map', () => {
  expectTypeOf<keyof EvaluationInput>().toEqualTypeOf<
    'headSha' | 'opener' | 'commits' | 'listing' | 'policy' | 'signatures' | 'allowlist' | 'orgMembers' | 'overrides'
  >();
  expectTypeOf<EvaluationInput['commits']>().toEqualTypeOf<readonly CommitFacts[]>();
  expectTypeOf<EvaluationInput['listing']>().toEqualTypeOf<'complete' | 'exceeded'>();
  expectTypeOf<EvaluationInput['policy']>().toEqualTypeOf<Policy | null>();
  expectTypeOf<EvaluationInput['signatures']>().toEqualTypeOf<readonly SignatureFact[]>();
  expectTypeOf<EvaluationInput['allowlist']>().toEqualTypeOf<readonly AllowlistEntry[]>();
  expectTypeOf<EvaluationInput['orgMembers']>().toEqualTypeOf<ReadonlyMap<number, ReadonlySet<number>>>();
  expectTypeOf<EvaluationInput['overrides']>().toEqualTypeOf<ReadonlyMap<string, number>>();
  expectTypeOf<keyof Policy>().toEqualTypeOf<'documentId' | 'activeMajor'>();
  expectTypeOf<keyof SignatureFact>().toEqualTypeOf<
    'id' | 'githubId' | 'documentId' | 'versionId' | 'major' | 'revoked'
  >();
  expectTypeOf<keyof AllowlistEntry>().toEqualTypeOf<'id' | 'kind' | 'githubId' | 'scope'>();
});

test('the covering basis is the shape the stored details accept, modulo readonly', () => {
  type StoredBasis = NonNullable<PrEvaluationDetails['actors'][number]['basis']>;
  expectTypeOf<CoveringBasis>().toExtend<StoredBasis>();
  expectTypeOf<StoredBasis>().toExtend<CoveringBasis>();
  expectTypeOf<Extract<CoveringBasis, { kind: 'signature' }>>().toEqualTypeOf<SignatureBasis>();
  expectTypeOf<Extract<CoveringBasis, { kind: 'allowlist' }>>().toEqualTypeOf<AllowlistBasis>();
});

// E21 adds `corporate_approval` as one more member. The union below stands in for that future type: the two branches that
// exist today are written exactly as the engine will write them, and they compile and behave the same with the new member.
interface CorporateApprovalBasis {
  readonly kind: 'corporate_approval';
  readonly approvalId: number;
}

function describeBasis(basis: CoveringBasis | CorporateApprovalBasis): string {
  switch (basis.kind) {
    case 'signature':
      return `signature ${basis.signatureId} v${basis.versionId} major ${basis.major}`;
    case 'allowlist':
      return `allowlist ${basis.entryId} ${basis.entryKind} ${basis.scope}`;
    case 'corporate_approval':
      return `approval ${basis.approvalId}`;
  }
}

test.each([
  [{ kind: 'signature', signatureId: 5, versionId: 3, major: 2 } as const, 'signature 5 v3 major 2'],
  [{ kind: 'allowlist', entryId: 9, entryKind: 'bot', scope: 'repository' } as const, 'allowlist 9 bot repository'],
  [{ kind: 'corporate_approval', approvalId: 4 } as const, 'approval 4'],
])('basis %j is told apart by its kind alone', (basis, expected) => {
  expect(describeBasis(basis)).toBe(expected);
});

test('the builders produce the shapes the types describe', () => {
  const input = evaluationInput({ commits: [commitFacts(2), commitFacts(3, { parents: [] })] });
  expect(input.commits.map((commit) => commit.parents)).toEqual([[sha(1)], []]);
  expect(input.policy).toEqual({ documentId: 1, activeMajor: 1 });
  expect(input.listing).toBe('complete');
  expect(input.orgMembers.size + input.overrides.size + input.allowlist.length + input.signatures.length).toBe(0);
});

test('a builder SHA is lower-case hex of the length the database accepts', () => {
  expect(sha(255)).toMatch(/^[0-9a-f]{40}$/);
  expect(sha(255).endsWith('ff')).toBe(true);
});

test('a builder commit is committed by its author, who is linked', () => {
  const commit = commitFacts(4);
  expect(commit.author).toEqual({ id: 4, type: 'User' });
  expect(commit.committer).toBe(commit.author);
});
