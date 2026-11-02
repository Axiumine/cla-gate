// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import { installationEligibility } from '../../domain/eligibility.ts';
import type { InstallationRow } from '../../services/installation-state.ts';
import { InstallationNotAdmittedError } from '../../services/ports/github-errors.ts';
import type { AuthorizeTenant, TenantAnswer } from '../../services/tenant-authorization.ts';
import { findTenantRows, type TenantRows } from '../../services/tenant-queries.ts';
import type { Database } from '../db/schema.ts';
import { requireAuth } from './auth-request.ts';
import { AppError } from './errors.ts';
import type { TenantAccess, TenantTarget } from './tenant-access.ts';

// The one guard of every tenant route (E11-S05). The order is fixed: the caller is known (`401`, by the guard of the route
// access), the resolver names the tenant, the stored tenant is read and its state looked at, the role facts are asked
// (cached, or fresh for a write), the pure decision is taken, a write to a suspended or deleted tenant is refused, and
// only then does the handler run, with `request.tenant`.
//
// Denials follow one table and are told apart only where the person already knows: `404 not_found` for a resource that is
// unknown, removed, of a tenant the policy rejected, or in an installation where the viewer has no role (the four are the
// same answer, byte for byte but for the request id); `403 forbidden` for a viewer who has a role here but too low a
// one; `409 installation_suspended` or `409 installation_deleted` for a write by someone allowed to make it; and
// `502`, `503` or `429` when GitHub could not say (E11-S04). The body never says what role the viewer holds.

export interface TenantGuardDeps {
  readonly db: Kysely<Database>;
  readonly authorize: AuthorizeTenant;
}

/** The answer to every call the viewer must not know the resource of. The same status, code and message whatever the cause. */
function notFound(): AppError {
  return new AppError(404, 'not_found');
}

/** The stored tenant, or the `404` for one that is not there (or whose repository is not, or is removed, or is another installation's). */
async function readTenant(db: Kysely<Database>, target: TenantTarget): Promise<TenantRows> {
  const rows = await findTenantRows(db, target.installationId, target.repositoryId);
  if (rows === null) {
    throw notFound();
  }
  return rows;
}

/** Why a tenant is not active: the installation is suspended on GitHub, or the App was uninstalled. */
type InactiveReason = 'installation_suspended' | 'installation_deleted';

/**
 * Why the tenant is not active, or null when it is: the state of the stored row (E05-S06), read for every request, so no
 * transition needs to tell the guard. A tenant the admission policy rejected is invisible and is the `404` here, whatever the
 * resolver said: a resolver that forgets to leave it out cannot let it through.
 */
function inactiveReason(installation: InstallationRow): InactiveReason | null {
  const served = installationEligibility({
    admissionStatus: installation.admission_status,
    deletedAt: installation.deleted_at,
    suspendedAt: installation.suspended_at,
  });
  if (served.eligible) {
    return null;
  }
  if (served.reason === 'installation_rejected') {
    throw notFound();
  }
  return served.reason;
}

/** One request of a tenant route as the guard has it once the tenant is read. */
interface Call {
  readonly request: FastifyRequest;
  readonly access: TenantAccess;
  readonly target: TenantTarget;
  readonly rows: TenantRows;
  readonly inactive: InactiveReason | null;
}

/**
 * What the role lookups say, with an installation that GitHub stopped serving between the read of the row and the lookup
 * (its token is refused) told as the tenant that is not there. Every other failure is thrown for the HTTP edge to map.
 */
async function answerFor(authorize: AuthorizeTenant, call: Call): Promise<TenantAnswer> {
  const { user } = requireAuth(call.request);
  try {
    return await authorize({
      mode: call.access.mode,
      requirement: call.target.requirement,
      installation: call.rows.installation,
      repository: call.rows.repository,
      viewer: { githubId: user.githubId, login: user.login },
      active: call.inactive === null,
    });
  } catch (error) {
    throw error instanceof InstallationNotAdmittedError ? notFound() : error;
  }
}

/**
 * Runs the guard for one request of a tenant route and sets `request.tenant`.
 * @throws AppError `404 not_found`, `403 forbidden` or `409 installation_suspended` / `installation_deleted`; the failures
 * of the role lookups as they are (E11-S04 maps them); and the `400` of a resolver for an id that cannot be one.
 */
export async function guardTenant(deps: TenantGuardDeps, request: FastifyRequest, access: TenantAccess): Promise<void> {
  const target = await access.resolve(request);
  if (target === null) {
    throw notFound();
  }
  const rows = await readTenant(deps.db, target);
  const call = { request, access, target, rows, inactive: inactiveReason(rows.installation) };
  const answer = await answerFor(deps.authorize, call);
  if (answer.decision === 'forbidden') {
    throw new AppError(403, 'forbidden');
  }
  if (answer.decision === 'not_found') {
    throw notFound();
  }
  if (call.inactive !== null && access.mode === 'write') {
    throw new AppError(409, call.inactive);
  }
  request.tenant = { installationId: target.installationId, repositoryId: target.repositoryId, role: answer.role };
}
