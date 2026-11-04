// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import type { JobEnqueuer } from './ports/jobs.ts';
import { requireActiveCla } from './repository-enablement-checks.ts';
import { sendEnableSweep } from './repository-enablement-sweep.ts';
import { switchRepository } from './repository-switch.ts';
import type { SwitchDirection, SwitchRequest } from './repository-switch-types.ts';

// Turning enforcement on for a repository (E14-S03): the switch of `repository-switch.ts` in the direction that wants a CLA to
// enforce and sends the sweep of the pull requests that are already open.

/** One request to turn enforcement on for a repository. */
export type EnableRequest = SwitchRequest;

/** The answer: the repository enforces now, and the call is the one that made it. */
export interface Enabled {
  readonly enabled: true;
  readonly changed: boolean;
}

const ENABLE: SwitchDirection = { enabled: true, require: requireActiveCla, send: sendEnableSweep };

/**
 * Turns enforcement on for a repository of the tenant: `repositories.enabled` becomes true, the audit row `repository.enabled`
 * (ids only) is appended by `setRepositoryEnabled`, and one `sweep-repository` job with the reason `repository_enabled` is sent so
 * that the pull requests that are already open are evaluated, all in one transaction under the lock of the repository row. A call
 * that finds the repository enabled (the second of two simultaneous ones, say) changes, audits and sends nothing. The role is
 * judged by the repository-action rule on the document read under the lock, and only then is the absence of a CLA to enforce
 * reported, so the role decides what a person learns. A failure at any step, a throwing enqueuer included, rolls everything back,
 * and a retry then succeeds. No call is made to GitHub.
 * @throws ClaRuleError `not_found` (the repository left the tenant since the guard read it), `forbidden` (the role is too low for
 * the document the repository enforces), `no_active_cla`. Anything the enqueuer rejects with.
 */
export async function enableRepository(
  db: Kysely<Database>,
  scope: TenantScope,
  enqueuer: JobEnqueuer,
  request: EnableRequest,
): Promise<Enabled> {
  const { changed } = await switchRepository(db, scope, enqueuer, { ...request, direction: ENABLE });
  return { enabled: true, changed };
}
