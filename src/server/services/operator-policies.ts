// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../shared/github-id.ts';
import { type AppOwner, createOperatorPolicy, effectiveOperatorIds, type OperatorPolicy } from '../domain/operator.ts';

/** The part of a logger the policy uses. A pino logger and a Fastify logger are one. */
interface PolicyLog {
  info(fields: object, message: string): void;
}

/** The effective operator policy of the instance (E11-S08). */
export interface OperatorPolicies {
  /**
   * The people who operate the instance. With `OPERATOR_GITHUB_IDS` set, GitHub is not asked. Without it the owner of the
   * App decides: it is known once the start-up self-check (E05-S02) has succeeded, and if an outage skipped it the first
   * call repeats it. The first successful answer is kept for the life of the process (the list and the owner change only
   * with a restart) and is logged once as `github.operator_policy` with the effective ids. A failure is not kept: the
   * next call asks again, and the failure is thrown, so an outage is never read as "nobody operates this instance" or as
   * "everybody does".
   */
  current(): Promise<OperatorPolicy>;
}

export interface OperatorPoliciesOptions {
  /** `OPERATOR_GITHUB_IDS`; undefined when unset. */
  readonly configured: readonly GithubId[] | undefined;
  /**
   * The owner of the App, from the verified identity. Undefined when no GitHub App is configured: the owner is then
   * unknown and, without `OPERATOR_GITHUB_IDS`, the instance has no operator.
   */
  readonly owner: (() => Promise<AppOwner>) | undefined;
  readonly logger: PolicyLog;
}

export function createOperatorPolicies(options: OperatorPoliciesOptions): OperatorPolicies {
  const { configured, owner, logger } = options;
  let pending: Promise<OperatorPolicy> | undefined;
  const build = async (): Promise<OperatorPolicy> => {
    const policy = createOperatorPolicy(configured, configured === undefined ? await owner?.() : undefined);
    logger.info({ operatorIds: effectiveOperatorIds(policy) }, 'github.operator_policy');
    return policy;
  };
  return {
    current() {
      pending ??= build().catch((error: unknown) => {
        pending = undefined;
        throw error;
      });
      return pending;
    },
  };
}
