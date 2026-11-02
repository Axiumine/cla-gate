// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { GithubId } from '../../shared/github-id.ts';
import type { InstallationRowId } from '../adapters/db/installation-row-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import { forgetAdminSeen, recordAdminSeen, wasAdminSeenSince } from './admin-ledger-queries.ts';
import type { Clock } from './ports/clock.ts';
import type { CachedOrgAdminLookup } from './role-lookups.ts';

// The ledger of org admins (E11-S07): the one bounded exception to "a role is verified live". GitHub refuses installation
// tokens for a suspended or uninstalled installation, so while the App is in that state nobody's role can be asked of it.
// To let an admin keep reading and exporting signature evidence then, the application remembers, per organisation, who a
// live lookup last saw as an admin:
//
//   written   on every live positive org-admin result, at most once per 60 seconds per pair
//   deleted   on a live negative result, so a demotion seen while the App is active ends the entry at once
//   read      only for a suspended or deleted tenant, counting entries seen in the last 14 days
//
// The cost, accepted and written down in the decision record: a person demoted while the App is suspended or removed keeps
// read access for at most 14 days in that state. Numeric ids only; an installation of a user account needs no entry (its
// owner is `installations.account_id`), and a rejected tenant is invisible, so no ledger applies to it.

/**
 * How long an entry keeps its owner a ledger admin of a suspended or deleted tenant.
 * @internal Exported for the tests, which hold the window to the 14 days of the decision (Knip ignores `@internal` exports in production mode).
 */
export const INACTIVE_ADMIN_WINDOW_DAYS = 14;

/** A pair is written at most once in this many seconds. */
const REFRESH_SECONDS = 60;

const DAY_MS = 86_400_000;

export interface AdminLedger {
  /** A live lookup found the person an admin of the organisation: remember it (at most once a minute per pair). */
  record(installationId: InstallationRowId, person: GithubId): Promise<void>;
  /** A live lookup found the person no longer an admin: forget them. */
  forget(installationId: InstallationRowId, person: GithubId): Promise<void>;
  /** Whether the person was seen as an admin of this tenant within {@link INACTIVE_ADMIN_WINDOW_DAYS} days of now. */
  isAdmin(installationId: InstallationRowId, person: GithubId): Promise<boolean>;
}

/** The ledger over `db`, taking "now" from `clock`. */
export function createAdminLedger(options: { readonly db: Kysely<Database>; readonly clock: Clock }): AdminLedger {
  const { db, clock } = options;
  return {
    record: async (installationId, person) => {
      const now = clock.now();
      await recordAdminSeen(db, { installationId }, person, {
        seenAt: now,
        refreshAtOrBefore: new Date(now.getTime() - REFRESH_SECONDS * 1000),
      });
    },
    forget: async (installationId, person) => {
      await forgetAdminSeen(db, { installationId }, person);
    },
    isAdmin: (installationId, person) =>
      wasAdminSeenSince(
        db,
        { installationId },
        person,
        new Date(clock.now().getTime() - INACTIVE_ADMIN_WINDOW_DAYS * DAY_MS),
      ),
  };
}

/**
 * `lookup` with the ledger kept up to date by what it finds. It wraps the lookup that sits behind the role cache, so it runs
 * for a live answer only (a cached one asks nobody and writes nothing). Only an organisation has a ledger: the owner of a
 * user account is known from the row. A lookup that throws writes nothing, and the error is the caller's as it was; an error
 * of the ledger itself is thrown too, so a failure to record is never swallowed (and is no answer, so the cache keeps nothing).
 *
 * The same rule as the cache's applies to the ledger: a lookup that a fresh one displaced, or that an invalidation dropped,
 * while it waited for GitHub (`context.isCurrent()` is false) answers its own caller and writes nothing, so an older "admin"
 * cannot put a demoted admin back, nor an older "not an admin" take a newer one out. Without a context (no cache in front)
 * the lookup is the only one there is.
 */
export function recordingAdmins(lookup: CachedOrgAdminLookup, ledger: AdminLedger): CachedOrgAdminLookup {
  return async (installation, viewer, context) => {
    const admin = await lookup(installation, viewer, context);
    if (installation.account_type === 'Organization' && (context?.isCurrent() ?? true)) {
      await (admin ? ledger.record(installation.id, viewer.githubId) : ledger.forget(installation.id, viewer.githubId));
    }
    return admin;
  };
}
