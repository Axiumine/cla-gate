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

// E08-S04: is every actor covered, and by what. An actor is covered by a signature, by an allowlist entry or (E21-S05) by
// a corporate approval, nothing else. All are looked up by numeric id; the account type decides which can apply.

/**
 * Only a person can consent. A bot cannot, and neither can an organisation or a mannequin (an unclaimed placeholder
 * account): a signature fact that carries the id of one of them is ignored, and they are covered by an allowlist entry
 * only. `unknown` is a co-author whose type GitHub never told us, so it may have signed as a person.
 */
const CAN_CONSENT: readonly AccountClass[] = ['human', 'unknown'];

/** No one: the outdated set of an evaluation without an active CLA, where nothing is read of corporate agreements. */
const NOBODY: ReadonlySet<number> = new Set();

/** The facts, indexed once per evaluation, so the cost of an actor does not grow with the number of signatures. */
interface Lookups {
  readonly signatures: SignatureIndex;
  readonly allowlist: AllowlistIndex;
  readonly orgMembers: CoverageFacts['orgMembers'];
  readonly corporateCovered: CoverageFacts['corporateCovered'];
}

/**
 * The first basis that applies, in a fixed order so the stored basis is deterministic. A signature wins over an allowlist
 * match: explicit consent is the stronger basis and it survives the entry being removed later. Then comes the allowlist
 * match of E08-S03, and last the approval of a corporate agreement (E21-S05), which only a person can hold: it covers a
 * contributor who did not consent for themselves, so it is the basis of last resort and never hides one of the others.
 */
function coveringBasis(account: Account, lookups: Lookups): CoveringBasis | null {
  const person = CAN_CONSENT.includes(classifyAccount(account));
  const signature = person ? lookups.signatures.get(account.id) : undefined;
  if (signature !== undefined) {
    return signature;
  }
  const entry = matchIndexedAllowlist(account, lookups.allowlist, lookups.orgMembers);
  if (entry !== null) {
    return { kind: 'allowlist', entryId: entry.id, entryKind: entry.kind, scope: entry.scope };
  }
  const cover = person ? lookups.corporateCovered.get(account.id) : undefined;
  return cover === undefined
    ? null
    : { kind: 'corporate_approval', agreementId: cover.agreementId, approvalId: cover.approvalId };
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

/** The actor with its basis; an uncovered person with an approval under an outdated agreement carries the mark of E21-S05. */
function withBasis(actor: ExtractedActor, basis: CoveringBasis | null, outdated: ReadonlySet<number>): CoveredActor {
  const marked =
    basis === null && outdated.has(actor.account.id) && CAN_CONSENT.includes(classifyAccount(actor.account));
  return { ...actor, covered: basis !== null, basis, ...(marked ? { corporateOutdated: true } : {}) };
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
      actors: actors.map((actor) => withBasis(actor, null, NOBODY)),
      fixes: [],
    };
  }
  const lookups: Lookups = {
    signatures: indexCoveringSignatures(policy, facts.signatures),
    allowlist: indexAllowlist(facts.allowlist),
    orgMembers: facts.orgMembers,
    corporateCovered: facts.corporateCovered,
  };
  const assessed = actors.map((actor) =>
    withBasis(actor, coveringBasis(actor.account, lookups), facts.corporateOutdated),
  );
  const shortfalls = assessed.filter((actor) => !actor.covered).map((actor) => shortfallOf(actor.account));
  const failureCodes = sortedUniqueCodes(shortfalls.map((shortfall) => shortfall.failureCode));
  return {
    outcome: outcomeOf(failureCodes),
    failureCodes,
    actors: assessed,
    fixes: shortfalls.map((shortfall) => shortfall.fix).sort(compareFixes),
  };
}
