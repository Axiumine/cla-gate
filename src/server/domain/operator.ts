// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type GithubId, githubIdSchema } from '../../shared/github-id.ts';

// Who runs the instance (E11-S08). Pure: the caller builds the policy from the configuration and the verified App owner, and
// asks it about the numeric id of the person in the session. The login never reaches this module. The operator sees the
// list of installations the instance knows (the operator route) and nothing else: this role is not a tenant role, so it
// opens no signature, no signer and no tenant route (the tenant guard of E11-S05 does not read it).

/** The people who operate the instance. Build it with {@link createOperatorPolicy}. */
export interface OperatorPolicy {
  readonly githubIds: ReadonlySet<GithubId>;
}

/** The account that owns the GitHub App, as the self-check of the App names it (E05-S02). `type` is GitHub's, as text. */
export interface AppOwner {
  readonly id: GithubId;
  readonly type: string;
}

/**
 * The effective policy. `OPERATOR_GITHUB_IDS` set: exactly the ids it names, the owner of the App is not added. Unset: the
 * owner of the App when it is a `User` (the person who installed the App on their own account), nobody when it is an
 * `Organization` or any other kind of account (an organisation is not a person who can sign in), and nobody when the owner
 * is not known (no GitHub App is configured).
 */
export function createOperatorPolicy(
  configured: readonly GithubId[] | undefined,
  owner: AppOwner | undefined,
): OperatorPolicy {
  if (configured !== undefined) {
    return { githubIds: new Set(configured) };
  }
  return { githubIds: new Set(owner?.type === 'User' ? [owner.id] : []) };
}

/** The ids of the policy, ascending: what the start-up log prints. */
export function effectiveOperatorIds(policy: OperatorPolicy): GithubId[] {
  return [...policy.githubIds].sort((a, b) => a - b);
}

/**
 * Whether the person with this numeric GitHub id operates the instance. The argument is `unknown` on purpose: it comes from
 * a session row, and anything that is not a positive safe integer (`0`, `-1`, `NaN`, a float, a string, a bigint, `null`) is
 * refused, even when its text would equal an id in the list. A login is never an identity here.
 */
export function isOperator(githubId: unknown, policy: OperatorPolicy): boolean {
  const parsed = githubIdSchema.safeParse(githubId);
  return parsed.success && policy.githubIds.has(parsed.data);
}
