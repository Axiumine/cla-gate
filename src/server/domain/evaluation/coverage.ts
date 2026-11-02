// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ExtractedActor } from './actor-types.ts';
import { type AllowlistIndex, indexAllowlist, matchIndexedAllowlist } from './allowlist.ts';
import { type AccountClass, classifyAccount } from './classify.ts';
import type { ActorFix, CoverageFacts, CoverageResult, CoveredActor } from './coverage-types.ts';
import { compareText } from './order.ts';
import { outcomeOf, sortedUniqueCodes } from './outcome.ts';
import { indexCoveringSignatures, type SignatureIndex } from './signatures.ts';
import type { Account, CoveringBasis, FailureCode } from './types.ts';

// E08-S04: is every actor covered, and by what. An actor is covered by a signature or by an allowlist entry, nothing
// else. Both are looked up by numeric id; the account type decides which of the two can apply.

/**
 * Only a person can consent. A bot cannot, and neither can an organisation or a mannequin (an unclaimed placeholder
 * account): a signature fact that carries the id of one of them is ignored, and they are covered by an allowlist entry
 * only. `unknown` is a co-author whose type GitHub never told us, so it may have signed as a person.
 */
const CAN_CONSENT: readonly AccountClass[] = ['human', 'unknown'];

/** The facts, indexed once per evaluation, so the cost of an actor does not grow with the number of signatures. */
interface Lookups {
  readonly signatures: SignatureIndex;
  readonly allowlist: AllowlistIndex;
  readonly orgMembers: CoverageFacts['orgMembers'];
}

/**
 * The first basis that applies. A signature wins over an allowlist match: explicit consent is the stronger basis and it
 * survives the entry being removed later. Then comes the allowlist match of E08-S03.
 */
function coveringBasis(account: Account, lookups: Lookups): CoveringBasis | null {
  if (CAN_CONSENT.includes(classifyAccount(account))) {
    const signature = lookups.signatures.get(account.id);
    if (signature !== undefined) {
      return signature;
    }
  }
  const entry = matchIndexedAllowlist(account, lookups.allowlist, lookups.orgMembers);
  return entry === null ? null : { kind: 'allowlist', entryId: entry.id, entryKind: entry.kind, scope: entry.scope };
}

interface Shortfall {
  readonly failureCode: FailureCode;
  readonly fix: ActorFix;
}

/**
 * Why an uncovered actor fails and what fixes it. A bot needs an allowlist entry (`bot_not_allowlisted`). A person or an
 * unknown co-author needs to sign. An organisation or mannequin cannot sign, so it is told to ask for an allowlist entry,
 * but it is still an unsigned contributor: the failure code is about the missing coverage, the fix about the way out.
 */
function shortfallOf(account: Account): Shortfall {
  const githubId = account.id;
  switch (classifyAccount(account)) {
    case 'bot':
      return { failureCode: 'bot_not_allowlisted', fix: { code: 'allowlist_bot', githubId } };
    case 'other':
      return { failureCode: 'unsigned_contributor', fix: { code: 'allowlist_account', githubId } };
    case 'human':
    case 'unknown':
      return { failureCode: 'unsigned_contributor', fix: { code: 'sign_cla', githubId } };
  }
}

function compareFixes(a: ActorFix, b: ActorFix): number {
  return compareText(a.code, b.code) || a.githubId - b.githubId;
}

function withBasis(actor: ExtractedActor, basis: CoveringBasis | null): CoveredActor {
  return { ...actor, covered: basis !== null, basis };
}

/**
 * Decides, for every actor, whether it is covered and records the basis. Without an active CLA nothing can be covered:
 * the verdict is `no_active_cla`, every actor is listed uncovered with no basis (an allowlist entry cannot stand in for a
 * document that does not exist), and no other code or fix is added, because signing or allowlisting would not help. With
 * a CLA, each uncovered actor adds its failure code and fix. The opener is among the actors whatever the commits say
 * (E08-S02), so an unsigned opener fails the pull request however well its commits are covered.
 */
export function assessCoverage(facts: CoverageFacts, actors: readonly ExtractedActor[]): CoverageResult {
  const { policy } = facts;
  if (policy === null) {
    return {
      outcome: 'failure',
      failureCodes: ['no_active_cla'],
      actors: actors.map((actor) => withBasis(actor, null)),
      fixes: [],
    };
  }
  const lookups: Lookups = {
    signatures: indexCoveringSignatures(policy, facts.signatures),
    allowlist: indexAllowlist(facts.allowlist),
    orgMembers: facts.orgMembers,
  };
  const assessed = actors.map((actor) => withBasis(actor, coveringBasis(actor.account, lookups)));
  const shortfalls = assessed.filter((actor) => !actor.covered).map((actor) => shortfallOf(actor.account));
  const failureCodes = sortedUniqueCodes(shortfalls.map((shortfall) => shortfall.failureCode));
  return {
    outcome: outcomeOf(failureCodes),
    failureCodes,
    actors: assessed,
    fixes: shortfalls.map((shortfall) => shortfall.fix).sort(compareFixes),
  };
}
