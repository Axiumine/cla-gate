// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { Routing } from '../domain/webhook-routing-types.ts';
import {
  type AdmittedRouting,
  isTenantJob,
  judgeInstallation,
  judgeRepository,
  type TenantJob,
  type TenantVerdict,
} from '../domain/webhook-tenant.ts';
import { findInstallationByGithubId } from './installation-queries.ts';
import { createLogLimiter } from './log-limiter.ts';
import type { Clock } from './ports/clock.ts';
import { isActiveRepositoryOfAnotherInstallation } from './repository-queries.ts';

// The tenant and admission filter of the webhook intake (E06-S05). The request path reads the database and nothing
// else: no GitHub call, and no policy that could make one. What it reads is the state the last sync wrote (E05-S06,
// E05-S07), so an installation the policy rejected, or one uninstalled or suspended, never reaches a queue.

/** The one WARN a rejected tenant gets per installation: this long between two lines. */
const LOG_WINDOW_MS = 60_000;

/** Installations remembered by the log limit; the 10,000 installations of the largest instance fit with room to spare. */
const LOG_MAX_INSTALLATIONS = 10_000;

/** The part of a logger the filter uses. A request's logger is one. */
interface TenantLog {
  warn(fields: object, message: string): void;
}

export interface TenantFilterOptions {
  readonly db: Kysely<Database>;
  /** Where the once-a-minute limit of the log takes its time from. */
  readonly clock: Clock;
}

export interface TenantFilter {
  /**
   * What the routed delivery becomes once its tenant is known. A routing that is not a job of a tenant's repository
   * (`ping`, an ignored delivery, `sync-installation`, `revoke-user-sessions`) is returned as it is, with no read.
   * Otherwise the stored installation named by the payload is read, and for an installation that is served the stored
   * repository too; the delivery then stays the job it was, is ignored with the reason, or is replaced by a sync.
   * A failing read is not caught: the delivery fails and GitHub can redeliver it, never lets a tenant through unchecked.
   */
  admit(routing: Routing, log: TenantLog): Promise<AdmittedRouting>;
}

/** What the filter reads: the database, and nothing else. */
type Reader = Pick<TenantFilterOptions, 'db'>;

/** The installation's verdict, then (only for one that is served) the repository's. At most two statements. */
async function verdictFor({ db }: Reader, job: TenantJob): Promise<TenantVerdict> {
  const installation = await findInstallationByGithubId(db, job.githubInstallationId);
  const verdict = judgeInstallation(
    job,
    installation === null
      ? null
      : {
          admissionStatus: installation.admission_status,
          deletedAt: installation.deleted_at,
          suspendedAt: installation.suspended_at,
        },
  );
  if (installation === null || verdict.kind !== 'served') {
    return verdict;
  }
  const heldByAnotherInstallation = await isActiveRepositoryOfAnotherInstallation(
    db,
    installation.id,
    job.githubRepoId,
  );
  return judgeRepository(job, { heldByAnotherInstallation });
}

/** The WARN of a delivery that is not acted on: numeric ids and a constant, as the caller's limit allows. */
function warnOf(log: TenantLog, job: TenantJob, verdict: Exclude<TenantVerdict, { kind: 'served' }>): void {
  log.warn(
    { githubInstallationId: job.githubInstallationId, githubRepoId: job.githubRepoId, reason: verdict.reason },
    verdict.kind === 'ignored' ? 'webhook.tenant_refused' : 'webhook.tenant_redirected',
  );
}

export function createTenantFilter(options: TenantFilterOptions): TenantFilter {
  const logLimiter = createLogLimiter({
    clock: options.clock,
    windowMs: LOG_WINDOW_MS,
    maxKeys: LOG_MAX_INSTALLATIONS,
  });
  return {
    async admit(routing, log) {
      if (routing.kind !== 'job' || !isTenantJob(routing.job)) {
        return routing;
      }
      const verdict = await verdictFor(options, routing.job);
      if (verdict.kind === 'served') {
        return routing;
      }
      if (logLimiter.allow(routing.job.githubInstallationId)) {
        warnOf(log, routing.job, verdict);
      }
      return verdict;
    },
  };
}
