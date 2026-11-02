// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyRequest } from 'fastify';
import type { Requirement } from '../../domain/authz.ts';
import type { RoleLookupMode } from '../../services/role-lookups.ts';
import type { InstallationRowId } from '../db/installation-row-id.ts';

// What a tenant route declares (E11-S05): the mode of the call and the resolver that names the tenant (and the repository)
// the request is about. The guard that acts on it is in tenant-guard.ts; the resolvers every route can use are in
// tenant-resolvers.ts; the decision itself is the pure `decide` of src/server/domain/authz.ts.

/**
 * What a resolver found a request to be about. `installationId` is `installations.id` (the surrogate key behind the
 * composite foreign keys), never GitHub's installation id, which appears in no URL. `repositoryId` is `repositories.id`.
 * A call that needs the `repo_admin` role names a repository, so the type has no `repo_admin` without one.
 */
export type TenantTarget =
  | { readonly installationId: InstallationRowId; readonly repositoryId: null; readonly requirement: 'org_admin' }
  | { readonly installationId: InstallationRowId; readonly repositoryId: number; readonly requirement: Requirement };

/**
 * Names the tenant a request is about, or `null` when there is none the caller may know of: an unknown id, a removed
 * repository and a tenant the admission policy rejected all resolve to `null`. A resolver reads with the installation id
 * in every query and throws an `AppError` (400) for an id that cannot be one. E12 to E16 add resolvers for documents,
 * signatures and entries, which compute the requirement from the scope of the resource (the role matrix of the security
 * notes).
 */
export type TenantResolver = (request: FastifyRequest) => Promise<TenantTarget | null>;

/** The `config.access` value of a tenant route: see {@link tenantAccess}. */
export interface TenantAccess {
  readonly kind: 'tenant';
  readonly mode: RoleLookupMode;
  readonly resolve: TenantResolver;
}

/**
 * The `config.access` of a route that acts inside one tenant. `mode` is `read` (a role answer up to 60 s old will do) or
 * `write` (the role is asked of GitHub again, and a suspended or deleted tenant refuses the call with a 409); a route that
 * changes data is always `write`. `resolve` names the tenant and the requirement of the call. The guard of E11-S05 runs
 * them in a fixed order and hands the handler `request.tenant`.
 */
export function tenantAccess(options: {
  readonly mode: RoleLookupMode;
  readonly resolve: TenantResolver;
}): TenantAccess {
  return { kind: 'tenant', mode: options.mode, resolve: options.resolve };
}

/**
 * The role the viewer holds in the tenant, named like the requirement it satisfies: `org_admin` for an admin of the
 * account the installation belongs to, `repo_admin` for an admin of the repository who is not one.
 */
export type TenantRole = Requirement;

/** What a handler of a tenant route reads, and the only place it reads the installation from. */
export interface TenantContext {
  /** `installations.id`: never read again from the path, the query or the body. */
  readonly installationId: InstallationRowId;
  /** `repositories.id` of the repository the call is about, or null for a call about the installation. */
  readonly repositoryId: number | null;
  readonly role: TenantRole;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the guard of a tenant route once the call is allowed (E11-S05); null on every other route. */
    tenant: TenantContext | null;
  }
}

/**
 * The tenant a handler of a tenant route acts for.
 * @throws Error when the route is not a tenant route: that is a defect of the route, not a denial.
 */
export function requireTenant(request: FastifyRequest): TenantContext {
  if (request.tenant === null) {
    throw new Error('this route is not a tenant route: request.tenant is not set');
  }
  return request.tenant;
}
