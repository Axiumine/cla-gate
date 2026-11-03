// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import { createAdminLedger, recordingAdmins } from './admin-ledger.ts';
import { createOrgAdminLookup } from './org-admin.ts';
import type { Clock } from './ports/clock.ts';
import type { GitHubClient } from './ports/github.ts';
import { GitHubUnavailableError } from './ports/github-errors.ts';
import { createRepoAdminLookup } from './repo-admin.ts';
import { createRepoAdminDiscovery } from './repo-admin-discovery.ts';
import type { RoleCache } from './role-cache.ts';
import { createViewerLookupBudget } from './role-lookup-budget.ts';
import { createRoleLookups } from './role-lookups.ts';
import {
  type AuthorizeTenant,
  createTenantAuthorization,
  type TenantAuthorizationDeps,
} from './tenant-authorization.ts';

// The tenant authorisation of E11-S05 wired to what it reads: the GitHub client port for the roles, the role cache of
// E11-S04 in front of it, the database for the role-in-installation discovery, and one budget per person for the lookups
// that reach GitHub. The ledger of org admins (E11-S07) is kept by the lookup that sits behind the cache, so it sees live
// answers only, and is read for a suspended or deleted tenant.

/** The two calls a role is read with (E11-S02, E11-S03): the rest of the client port is not the guard's. */
export type RoleGitHub = Pick<GitHubClient, 'getOrgMembership' | 'getRepositoryPermission'>;

/** The part of a logger the lookups use. A Fastify logger is one. */
interface RoleLog {
  warn(fields: object, message: string): void;
}

export interface TenantAuthorizerOptions {
  readonly db: Kysely<Database>;
  readonly github: RoleGitHub;
  /** The cache every lookup goes through; the application's own, so logout and the session revocation can forget a person. */
  readonly cache: RoleCache;
  /** The per-person budget of uncached lookups takes its time from here. */
  readonly clock: Clock;
  readonly log: RoleLog;
}

/**
 * A GitHub the roles cannot be read from, for a server built with no GitHub App (E05-S01): every call fails as an outage,
 * so a tenant that needs GitHub for a role is `502 github_unavailable` and never allowed. A user account needs no call.
 */
export const roleGitHubNotWired: RoleGitHub = {
  getOrgMembership: () =>
    Promise.reject(new GitHubUnavailableError('no GitHub App is configured: roles cannot be read')),
  getRepositoryPermission: () =>
    Promise.reject(new GitHubUnavailableError('no GitHub App is configured: roles cannot be read')),
};

/**
 * What the authorisation reads, over the real lookups, the cache and the budget: the cached lookups, the discovery and the
 * ledger. The guard decides with it ({@link createTenantAuthorizer}) and the lists of E14-S01 ask the same lookups, so the
 * roles they show are the roles the guard enforces and both spend one budget of the person.
 */
export function createTenantAuthorizationDeps(options: TenantAuthorizerOptions): TenantAuthorizationDeps {
  const { db, github, log } = options;
  const ledger = createAdminLedger({ db, clock: options.clock });
  const lookups = createRoleLookups({
    cache: options.cache,
    budget: createViewerLookupBudget(options.clock),
    orgAdmin: recordingAdmins(createOrgAdminLookup({ github, log }), ledger),
    repoAdmin: createRepoAdminLookup({ github, log }),
  });
  return { lookups, discover: createRepoAdminDiscovery({ db, lookup: lookups.read.repoAdmin }), ledger };
}

/**
 * The authorisation over the real lookups, the cache and the budget.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode): the application builds the deps
 * itself, because the lists of E14-S01 read them too.
 */
export function createTenantAuthorizer(options: TenantAuthorizerOptions): AuthorizeTenant {
  return createTenantAuthorization(createTenantAuthorizationDeps(options));
}
