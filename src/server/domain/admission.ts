// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type GithubId, githubIdSchema } from '../../shared/github-id.ts';

// Which GitHub accounts this instance serves (E05-S07). Pure: the caller builds the policy from the configuration and
// the verified App owner, and asks it about an account id. Identity is the numeric account id and nothing else; a login
// never reaches this module. There is no wildcard: a policy is a finite list, so opening an instance to every account
// is not expressible.

/** The accounts the instance serves. Build it with {@link createAdmissionPolicy}. */
export interface AdmissionPolicy {
  readonly accountIds: ReadonlySet<GithubId>;
}

/** The answer for one account. `account_not_allowed` is the only reason a decision refuses. */
export type AdmissionVerdict =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly reason: 'account_not_allowed' };

/**
 * The effective policy: the configured account ids plus the App owner's own account. The owner is always served, so an
 * empty list means "the owner account only" and a list can never lock the owner out of its own App.
 */
export function createAdmissionPolicy(configured: readonly GithubId[], ownerAccountId: GithubId): AdmissionPolicy {
  return { accountIds: new Set([...configured, ownerAccountId]) };
}

/** The ids of the policy, ascending: what the start-up log prints. */
export function effectiveAccountIds(policy: AdmissionPolicy): GithubId[] {
  return [...policy.accountIds].sort((a, b) => a - b);
}

/**
 * Whether `accountId` is an account the policy serves. The argument is `unknown` on purpose: the id comes from a GitHub
 * payload or a database row, and anything that is not a positive safe integer (`0`, `-1`, `NaN`, a float, a string, a
 * bigint, `null`) is refused, even when its text would equal an id in the list.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode); the services ask {@link decideAccountAdmission}.
 */
export function decideAdmission(accountId: unknown, policy: AdmissionPolicy): AdmissionVerdict {
  const parsed = githubIdSchema.safeParse(accountId);
  return parsed.success && policy.accountIds.has(parsed.data)
    ? { admitted: true }
    : { admitted: false, reason: 'account_not_allowed' };
}

/**
 * Whether the instance serves an account: {@link decideAdmission} for a user or an organisation, never for any other kind
 * of account (`Other`, an enterprise). Account ids of different kinds are no promise about each other, so a list of ids
 * cannot make an `Other` account served by accident. The type is a string on purpose, like the id is `unknown`: it
 * comes from a GitHub payload or a database row.
 */
export function decideAccountAdmission(
  account: { readonly id: unknown; readonly type: string },
  policy: AdmissionPolicy,
): AdmissionVerdict {
  return account.type === 'User' || account.type === 'Organization'
    ? decideAdmission(account.id, policy)
    : { admitted: false, reason: 'account_not_allowed' };
}
