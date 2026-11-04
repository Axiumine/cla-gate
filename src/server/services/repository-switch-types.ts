// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import type { Role } from '../domain/authz.ts';
import type { JobEnqueuer } from './ports/jobs.ts';
import type { LockedRepository } from './repository-document-lock-queries.ts';

// The shapes of the switch of enforcement of a repository (E14-S03, E14-S04) that `repository-switch.ts` carries out: the request,
// the answer, and what differs between turning enforcement on and turning it off.

/** One request to turn enforcement on or off for a repository. */
export interface SwitchRequest {
  /** `repositories.id` of the repository, as the tenant guard resolved it. */
  readonly repositoryId: number;
  /** The role the guard let the person in with. */
  readonly role: Role;
  readonly actorGithubId: GithubId;
}

/** The answer: whether the repository enforces the CLA now, and whether the call is the one that changed it. */
export interface Switched {
  readonly enabled: boolean;
  readonly changed: boolean;
}

/** A switch to carry out: the request and the direction it goes. */
export interface Switch extends SwitchRequest {
  readonly direction: SwitchDirection;
}

/** What differs between turning enforcement on and turning it off. */
export interface SwitchDirection {
  /** The value `repositories.enabled` takes. */
  readonly enabled: boolean;
  /** The checks on the locked repository that come after the role (a CLA to enforce, for the way on); it throws a `ClaRuleError`. */
  readonly require: (repository: LockedRepository) => void;
  /** Sends the job that follows a change, in `trx`, the transaction of the change. */
  readonly send: (
    trx: Transaction<Database>,
    scope: TenantScope,
    enqueuer: JobEnqueuer,
    repository: LockedRepository,
  ) => Promise<void>;
}
