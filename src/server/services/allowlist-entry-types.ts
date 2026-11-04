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

// The list and the removal of entries (E14-S07).

/** Which kind of account an entry exempts. */
export type AllowlistKind = AllowlistEntryRequest['kind'];

/**
 * Where a page of a list starts: the first entry, included, as the list is ordered (`kind`, then `login_snapshot` with the entries
 * that have none last, then `id`). The login is part of the position because the order is by it; it is null for an entry with none.
 */
export interface EntryPosition {
  readonly kind: AllowlistKind;
  readonly loginSnapshot: string | null;
  readonly id: number;
}

/** An entry as a list shows it: the entry, and who made it by the numeric GitHub id with the login the `users` row holds now. */
export interface ListedEntry {
  readonly id: number;
  readonly scope: AllowlistTarget['scope'];
  /** `repositories.id`, or null for an entry that covers the installation. */
  readonly repositoryId: number | null;
  readonly kind: AllowlistKind;
  readonly githubId: GithubId;
  readonly loginSnapshot: string | null;
  readonly createdBy: { readonly githubId: GithubId; readonly login: string };
  readonly createdAt: Date;
}

/** One page of a list: the entries, and where the next page starts (null on the last page). */
export interface EntryPage {
  readonly entries: readonly ListedEntry[];
  readonly next: EntryPosition | null;
}

/** How a page is asked for: at most `limit` entries, from `from` (null: the start). */
export interface EntryPageRequest {
  readonly limit: number;
  readonly from: EntryPosition | null;
}

/** Which section of the list of a repository a page continues in: its own entries come first, then the installation's. */
type EntrySection = 'own' | 'inherited';

/** Where a page of the list of a repository starts: in which section, and at which entry of it (included). */
export interface RepositoryEntryFrom {
  readonly section: EntrySection;
  readonly position: EntryPosition;
}

/** One page of the list of a repository: `own` and `inherited` together hold at most the limit; `next` names the section it continues in. */
export interface RepositoryEntryPage {
  readonly own: readonly ListedEntry[];
  readonly inherited: readonly ListedEntry[];
  readonly next: RepositoryEntryFrom | null;
}

/** Everything the removal of an entry needs to know of the request. */
export interface EntryRemoval {
  /** `allowlist_entries.id`. */
  readonly entryId: number;
  /** The role the guard let the person in with. */
  readonly role: Role;
  /** The identity the audit row names. */
  readonly actorGithubId: GithubId;
}

/** What the removal works with: the database and the queue for the sweeps. */
export interface AllowlistRemovalDeps {
  readonly db: Kysely<Database>;
  readonly enqueuer: JobEnqueuer;
}
