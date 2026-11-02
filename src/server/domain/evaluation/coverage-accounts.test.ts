// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { assessCoverage } from './coverage.ts';
import type { ActorFix } from './coverage-types.ts';
import { allowlistEntry as entry, evaluationInput, extractedActor, membership, signatureFact } from './test-support.ts';
import type { AccountType, CoveringBasis, EvaluationInput, FailureCode } from './types.ts';

// E08-S04: coverage by kind of account. A person may sign; a bot, an organisation and a mannequin cannot consent, so
// only an allowlist entry covers them. Each row is one account (id 20) with the facts around it.

interface Row {
  readonly name: string;
  readonly type: AccountType;
  readonly facts: Partial<EvaluationInput>;
  readonly basis: CoveringBasis | null;
  readonly failure: FailureCode;
  readonly fix: ActorFix['code'];
}

const botEntry: CoveringBasis = { kind: 'allowlist', entryId: 4, entryKind: 'bot', scope: 'repository' };
const userEntry: CoveringBasis = { kind: 'allowlist', entryId: 4, entryKind: 'user', scope: 'repository' };
const sig = { kind: 'signature', signatureId: 1, versionId: 1001, major: 1 } satisfies CoveringBasis;

const rows: readonly Row[] = [
  {
    name: 'a bot with a signature fact is uncovered: a bot cannot consent',
    type: 'Bot',
    facts: { signatures: [signatureFact(1, 20)] },
    basis: null,
    failure: 'bot_not_allowlisted',
    fix: 'allowlist_bot',
  },
  {
    name: 'a bot with a bot entry is covered by the entry',
    type: 'Bot',
    facts: { allowlist: [entry(4, 'bot', 20)] },
    basis: botEntry,
    failure: 'bot_not_allowlisted',
    fix: 'allowlist_bot',
  },
  {
    name: 'a bot with only a user entry is uncovered',
    type: 'Bot',
    facts: { allowlist: [entry(4, 'user', 20)] },
    basis: null,
    failure: 'bot_not_allowlisted',
    fix: 'allowlist_bot',
  },
  {
    name: 'a bot is never covered through org_members',
    type: 'Bot',
    facts: { allowlist: [entry(4, 'org_members', 500)], orgMembers: membership([500, [20]]) },
    basis: null,
    failure: 'bot_not_allowlisted',
    fix: 'allowlist_bot',
  },
  {
    name: 'a bot with a signature fact and a bot entry is covered by the entry, not the signature',
    type: 'Bot',
    facts: { signatures: [signatureFact(1, 20)], allowlist: [entry(4, 'bot', 20)] },
    basis: botEntry,
    failure: 'bot_not_allowlisted',
    fix: 'allowlist_bot',
  },
  {
    name: 'a bot with nothing at all fails with the bot code',
    type: 'Bot',
    facts: {},
    basis: null,
    failure: 'bot_not_allowlisted',
    fix: 'allowlist_bot',
  },
  {
    name: 'an unknown account (a trailer co-author) with a signature is covered',
    type: 'Unknown',
    facts: { signatures: [signatureFact(1, 20)] },
    basis: sig,
    failure: 'unsigned_contributor',
    fix: 'sign_cla',
  },
  {
    name: 'an unknown account with a bot entry is covered by the entry',
    type: 'Unknown',
    facts: { allowlist: [entry(4, 'bot', 20)] },
    basis: botEntry,
    failure: 'unsigned_contributor',
    fix: 'sign_cla',
  },
  {
    name: 'an unknown account with nothing is told to sign',
    type: 'Unknown',
    facts: {},
    basis: null,
    failure: 'unsigned_contributor',
    fix: 'sign_cla',
  },
  {
    name: 'an organisation with a user entry is covered by the entry',
    type: 'Organization',
    facts: { allowlist: [entry(4, 'user', 20)] },
    basis: userEntry,
    failure: 'unsigned_contributor',
    fix: 'allowlist_account',
  },
  {
    name: 'an organisation with nothing is an unsigned contributor told to ask for an allowlist entry',
    type: 'Organization',
    facts: {},
    basis: null,
    failure: 'unsigned_contributor',
    fix: 'allowlist_account',
  },
  {
    name: 'an organisation with a signature fact is uncovered: it cannot consent',
    type: 'Organization',
    facts: { signatures: [signatureFact(1, 20)] },
    basis: null,
    failure: 'unsigned_contributor',
    fix: 'allowlist_account',
  },
  {
    name: 'a mannequin with a signature fact is uncovered: it cannot consent',
    type: 'Mannequin',
    facts: { signatures: [signatureFact(1, 20)] },
    basis: null,
    failure: 'unsigned_contributor',
    fix: 'allowlist_account',
  },
  {
    name: 'a mannequin with a user entry is covered by the entry',
    type: 'Mannequin',
    facts: { allowlist: [entry(4, 'user', 20)] },
    basis: userEntry,
    failure: 'unsigned_contributor',
    fix: 'allowlist_account',
  },
  {
    name: 'a person with a signature is covered',
    type: 'User',
    facts: { signatures: [signatureFact(1, 20)] },
    basis: sig,
    failure: 'unsigned_contributor',
    fix: 'sign_cla',
  },
  {
    name: 'a person with nothing is told to sign',
    type: 'User',
    facts: {},
    basis: null,
    failure: 'unsigned_contributor',
    fix: 'sign_cla',
  },
];

test.each(rows)('$name', ({ type, facts, basis, failure, fix }) => {
  const result = assessCoverage(evaluationInput(facts), [extractedActor(20, type)]);
  expect(result.actors.map((actor) => actor.basis)).toEqual([basis]);
  expect(result.actors.map((actor) => actor.covered)).toEqual([basis !== null]);
  expect(result.failureCodes).toEqual(basis === null ? [failure] : []);
  expect(result.fixes).toEqual(basis === null ? [{ code: fix, githubId: 20 }] : []);
});

test('the application slug of a bot changes nothing: a User named like an app is still a person', () => {
  const person = { account: { id: 20, type: 'User', appSlug: 'dependabot' }, roles: ['author'], shas: [] } as const;
  const bot = { account: { id: 20, type: 'Bot', appSlug: 'ordinary-name' }, roles: ['author'], shas: [] } as const;
  const facts = evaluationInput({ signatures: [signatureFact(1, 20)] });
  expect(assessCoverage(facts, [person]).actors.map((actor) => actor.basis?.kind)).toEqual(['signature']);
  expect(assessCoverage(facts, [bot]).actors.map((actor) => actor.basis)).toEqual([null]);
});
