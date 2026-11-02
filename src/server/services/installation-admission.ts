// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import { lockInstallation } from '../adapters/db/advisory-lock.ts';
import type { Database } from '../adapters/db/schema.ts';
import { withTransaction } from '../adapters/db/transaction.ts';
import { type AdmissionVerdict, decideAccountAdmission } from '../domain/admission.ts';
import type { AdmissionPolicies } from './admission-policies.ts';
import { appendAudit } from './audit.ts';
import { findInstallationByGithubId, upsertInstallation } from './installation-queries.ts';
import { type AdmissionDecision, accountTypeCode, type InstallationRow } from './installation-state.ts';
import type { Clock } from './ports/clock.ts';
import type { GitHubInstallation } from './ports/github.ts';

// Applying the admission policy to an installation (E05-S07): the decision is made by the pure domain function, stored
// on the installation row with the time it was made, and audited. A rejected installation is recorded and nothing else:
// no repository row is created for it and no request is made for it, so it is never touched.

/** What {@link InstallationAdmission.admit} did. */
interface AdmissionOutcome {
  /** The policy serves the account. */
  readonly admitted: boolean;
  /**
   * The decision was new or different from the stored one, so the row was written and one audit row appended. False
   * when the stored decision already said the same: a second run on unchanged state writes nothing and logs nothing.
   */
  readonly changed: boolean;
  /** The installation as stored after the call. */
  readonly installation: InstallationRow;
}

export interface InstallationAdmission {
  /**
   * Decides whether the instance serves the installation GitHub described, and stores the decision. A new
   * installation is inserted with the snapshot GitHub gave and the decision; a stored one is rewritten only when
   * the decision changes. `admission_decided_at` is the time of the last change of decision. An account that was admitted
   * and no longer is gets the reason `policy_changed`, every other refusal `account_not_allowed`.
   *
   * Runs under the installation's advisory lock, in the transaction of `within` when it is one (the sync of E05-S08),
   * else in its own. The WARN line of a rejection is written as soon as the rows are, so a caller that rolls back
   * afterwards has logged a decision that the next run makes again.
   * @throws whatever the policy, the database or the audit writer throws; nothing is written then.
   */
  admit(installation: GitHubInstallation, within?: Kysely<Database>): Promise<AdmissionOutcome>;
}

export interface InstallationAdmissionOptions {
  readonly db: Kysely<Database>;
  readonly policies: AdmissionPolicies;
  readonly clock: Clock;
  readonly logger: Logger;
}

function decisionFor(verdict: AdmissionVerdict, stored: InstallationRow | null, decidedAt: Date): AdmissionDecision {
  if (verdict.admitted) {
    return { status: 'admitted', reason: null, decidedAt };
  }
  const wasAdmitted = stored?.admission_status === 'admitted';
  return { status: 'rejected', reason: wasAdmitted ? 'policy_changed' : verdict.reason, decidedAt };
}

/** A stored row already carries this decision: it was decided (the default is an undecided rejection) and says the same. */
const alreadyDecided = (stored: InstallationRow, decision: AdmissionDecision): boolean =>
  stored.admission_decided_at !== null && stored.admission_status === decision.status;

function store(
  db: Kysely<Database>,
  installation: GitHubInstallation,
  decision: AdmissionDecision,
): Promise<InstallationRow> {
  return upsertInstallation(db, {
    githubInstallationId: installation.id,
    accountId: installation.account.id,
    accountLogin: installation.account.login,
    accountType: installation.account.type,
    suspendedAt: installation.suspendedAt,
    admission: decision,
  });
}

export function createInstallationAdmission(options: InstallationAdmissionOptions): InstallationAdmission {
  const { policies, clock, logger } = options;
  return {
    async admit(installation, within = options.db) {
      const policy = await policies.current();
      const verdict = decideAccountAdmission(installation.account, policy);
      const outcome = await withTransaction(within, async (trx) => {
        await lockInstallation(trx, installation.id);
        const stored = await findInstallationByGithubId(trx, installation.id);
        const decision = decisionFor(verdict, stored, clock.now());
        if (stored !== null && alreadyDecided(stored, decision)) {
          return { admitted: verdict.admitted, changed: false, installation: stored };
        }
        const row = await store(trx, installation, decision);
        await appendAudit(trx, {
          action: verdict.admitted ? 'installation.admitted' : 'installation.rejected',
          installationId: row.id,
          actorGithubId: null,
          subject: { type: 'installation', id: installation.id },
          metadata: {
            account_id: installation.account.id,
            account_type: accountTypeCode(installation.account.type),
            ...(decision.reason === null ? {} : { reason_code: decision.reason }),
          },
        });
        return { admitted: verdict.admitted, changed: true, installation: row };
      });
      if (outcome.changed && !outcome.admitted) {
        logger.warn(
          {
            githubInstallationId: installation.id,
            accountId: installation.account.id,
            accountType: accountTypeCode(installation.account.type),
            reasonCode: outcome.installation.admission_reason,
          },
          'installation.rejected',
        );
      }
      return outcome;
    },
  };
}
