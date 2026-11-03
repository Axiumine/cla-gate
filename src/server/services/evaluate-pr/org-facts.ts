// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import { type AllowlistEntry, type ExtractedActor, matchAllowlist } from '../../domain/evaluation/index.ts';
import type { OrgMembership } from '../org-membership.ts';

// The organisation membership facts of an evaluation (E07-S04). The engine treats an organisation without a fact as having
// no members, so a lookup that failed must fail the job instead of leaving a gap: partial facts would deny people who are
// members, and a denial that nobody can explain is a failed check that never goes away.

/** A person to look up: the numeric id decides, the login is only the handle GitHub's route takes. */
export interface Candidate {
  readonly id: GithubId;
  readonly login: string;
}

/** How many lookups run at once: the client's rate limiter paces them, this only keeps a pull request of many authors bounded. */
const LOOKUPS_AT_ONCE = 8;

export interface CandidateFacts {
  readonly actors: readonly ExtractedActor[];
  readonly allowlist: readonly AllowlistEntry[];
  /** The ids that hold a signature that covers the active CLA: already covered, so not worth a request. */
  readonly signed: ReadonlySet<number>;
  /** The accounts the job saw in the pull request and its commits, by numeric id, with the login each was seen under. */
  readonly seen: ReadonlyMap<number, Candidate>;
  /** The id of the installing organisation. */
  readonly orgId: number;
}

/**
 * The people whose membership of the installing organisation is worth asking about: only when the allowlist has an
 * `org_members` entry for that organisation, and then only for a person (a `User`, never a bot, an organisation, or a
 * co-author that only a trailer named, whose login is unknown) who holds no covering signature and matches no `user` or
 * `bot` entry, and whose login the job saw. Anyone else is covered already, cannot be covered this way, or has nothing to look up.
 */
export function lookupCandidates(facts: CandidateFacts): Candidate[] {
  const { actors, allowlist, signed, seen, orgId } = facts;
  if (!allowlist.some((entry) => entry.kind === 'org_members' && entry.githubId === orgId)) {
    return [];
  }
  const direct = allowlist.filter((entry) => entry.kind !== 'org_members');
  return actors.flatMap(({ account }) => {
    const candidate = seen.get(account.id);
    const asked =
      account.type === 'User' && !signed.has(account.id) && matchAllowlist(account, direct, new Map()) === null;
    return asked && candidate !== undefined ? [candidate] : [];
  });
}

/**
 * The membership facts for `candidates` of the organisation `orgId`: one entry holding the ids found to be active members.
 * A verdict of `permission_missing` is no membership (fail closed: the person is not exempt and may sign). An error of the
 * lookup (a rate limit, an outage) is not caught: the job fails and the queue retries it.
 */
export async function readOrgMembers(
  membership: OrgMembership,
  githubInstallationId: GithubId,
  orgId: number,
  candidates: readonly Candidate[],
): Promise<ReadonlyMap<number, ReadonlySet<number>>> {
  const members = new Set<number>();
  for (let from = 0; from < candidates.length; from += LOOKUPS_AT_ONCE) {
    const chunk = candidates.slice(from, from + LOOKUPS_AT_ONCE);
    const asked = await Promise.all(
      chunk.map(async (person) => ({
        person,
        verdict: await membership.isOrgMember({ githubInstallationId, userGithubId: person.id, login: person.login }),
      })),
    );
    for (const { person, verdict } of asked) {
      if (verdict === 'member') {
        members.add(person.id);
      }
    }
  }
  return new Map([[orgId, members]]);
}
