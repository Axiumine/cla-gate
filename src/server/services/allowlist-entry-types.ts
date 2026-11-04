// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { AllowlistEntryRequest } from '../../shared/allowlist.ts';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { Role } from '../domain/authz.ts';
import type { AllowlistGitHub } from './allowlist-account.ts';
import type { JobEnqueuer } from './ports/jobs.ts';

// The types of adding an allowlist entry (E14-S06), shared by the service (allowlist-entry-create.ts), its checks
// (allowlist-entry-checks.ts) and the routes.

/** What the entry covers: every repository of the installation, or one (`repositories.id`). */
export type AllowlistTarget =
  | { readonly scope: 'installation' }
  | { readonly scope: 'repository'; readonly repositoryId: number };

/** One request to add an entry. */
export interface NewAllowlistEntry {
  readonly target: AllowlistTarget;
  /** The role the guard let the person in with. */
  readonly role: Role;
  /** `id` is `users.id` (stored as `created_by`), `githubId` the identity the audit row and the answer name. */
  readonly actor: { readonly id: number; readonly githubId: GithubId };
  readonly entry: AllowlistEntryRequest;
}

/** The entry that was stored. */
export interface AllowlistEntry {
  readonly id: number;
  readonly scope: AllowlistTarget['scope'];
  /** `repositories.id`, or null for an entry that covers the installation. */
  readonly repositoryId: number | null;
  readonly kind: AllowlistEntryRequest['kind'];
  readonly githubId: GithubId;
  readonly loginSnapshot: string | null;
  readonly createdBy: GithubId;
  readonly createdAt: Date;
}

/** What the service works with: the database, GitHub for the lookups and the queue for the sweeps. */
export interface AllowlistDeps {
  readonly db: Kysely<Database>;
  readonly github: AllowlistGitHub;
  readonly enqueuer: JobEnqueuer;
}
