// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import type { JobEnqueuer } from './ports/jobs.ts';
import { sendDisableFinalise } from './repository-disablement-finalise.ts';
import { switchRepository } from './repository-switch.ts';
import type { SwitchDirection, SwitchRequest } from './repository-switch-types.ts';

// Turning enforcement off for a repository (E14-S04): the switch of `repository-switch.ts` in the direction that needs nothing
// but the role (a repository can always be turned off) and sends the job that completes the checks that would stay pending.
// The CLA document, the signatures, the allowlist and every `pr_evaluations` row are not touched: the one change is the flag.

/** One request to turn enforcement off for a repository. */
export type DisableRequest = SwitchRequest;

/** The answer: the repository does not enforce now, and the call is the one that made it so. */
export interface Disabled {
  readonly enabled: false;
  readonly changed: boolean;
}

const DISABLE: SwitchDirection = { enabled: false, require: () => undefined, send: sendDisableFinalise };

/**
 * Turns enforcement off for a repository of the tenant: `repositories.enabled` becomes false, the audit row `repository.disabled`
 * (ids only) is appended by `setRepositoryEnabled`, and one `finalise-repository` job is sent so that the checks left pending are
 * completed (`neutral`), all in one transaction under the lock of the repository row. A call that finds the repository off
 * already changes, audits and sends nothing. The role is judged by the repository-action rule on the document read under the
 * lock: the policy is the scope of the document the repository enforces, and an organisation admin satisfies both. A failure at
 * any step, a throwing enqueuer included, rolls everything back, and a retry then succeeds. No call is made to GitHub.
 * @throws ClaRuleError `not_found` (the repository left the tenant since the guard read it), `forbidden` (the role is too low for
 * the document the repository enforces). Anything the enqueuer rejects with.
 */
export async function disableRepository(
  db: Kysely<Database>,
  scope: TenantScope,
  enqueuer: JobEnqueuer,
  request: DisableRequest,
): Promise<Disabled> {
  const { changed } = await switchRepository(db, scope, enqueuer, { ...request, direction: DISABLE });
  return { enabled: false, changed };
}
