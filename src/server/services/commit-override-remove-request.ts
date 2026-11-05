// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { Role } from '../domain/authz.ts';
import type { JobEnqueuer } from './ports/jobs.ts';

// The request to remove a per-commit override (E15-S06) as the route reads it, and what the removal works with. The rules are in
// commit-override-remove.ts.

/** What the removal works with: the database and the queue the jobs of the re-evaluation are sent to. */
export interface CommitOverrideRemovalDeps {
  readonly db: Kysely<Database>;
  readonly enqueuer: JobEnqueuer;
}

/** One request to remove an override, as the route read it. */
export interface OverrideRemoval {
  /** `repositories.id`. */
  readonly repositoryId: number;
  /** `commit_overrides.id`. */
  readonly overrideId: number;
  /** The role the guard let the person in with. */
  readonly role: Role;
  /** The identity the audit row names. */
  readonly actorGithubId: GithubId;
}
