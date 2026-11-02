// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import type { GithubId } from '../../shared/github-id.ts';
import { type AdmissionPolicy, createAdmissionPolicy, effectiveAccountIds } from '../domain/admission.ts';

/** The effective admission policy of the instance (E05-S07). */
export interface AdmissionPolicies {
  /**
   * The configured account ids plus the App owner's. The owner is known once the start-up self-check (E05-S02) has
   * succeeded; if an outage skipped it, the first call repeats it. The first successful answer is kept for the life of
   * the process, since changing the list needs a restart, and is logged once as `github.admission_policy` with the
   * ids it contains. A failure is not kept: the next call asks again, and nothing is admitted meanwhile.
   */
  current(): Promise<AdmissionPolicy>;
}

export interface AdmissionPoliciesOptions {
  /** `GITHUB_ALLOWED_ACCOUNT_IDS`. */
  readonly configured: readonly GithubId[];
  /** The id of the account that owns the App, from the verified identity. */
  readonly ownerAccountId: () => Promise<GithubId>;
  readonly logger: Logger;
}

export function createAdmissionPolicies(options: AdmissionPoliciesOptions): AdmissionPolicies {
  let pending: Promise<AdmissionPolicy> | undefined;
  const build = async (): Promise<AdmissionPolicy> => {
    const policy = createAdmissionPolicy(options.configured, await options.ownerAccountId());
    options.logger.info({ accountIds: effectiveAccountIds(policy) }, 'github.admission_policy');
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
