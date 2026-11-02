// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { ACCESS_KINDS, accessSchema, type RouteAccess, WEBHOOK_ROUTES } from './route-access-model.ts';

// What is wrong with the access declaration of a route (E11-S01): the checks the start-up hook of route-access.ts runs on
// every route of the table.

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * The path parameters that name a tenant resource: a route with one of them is a tenant route, never `authenticated`,
 * `operator` (who sees the list of installations and nothing inside one, E11-S08) or `public`. `:githubRepoId` is not one
 * (the resolver of E11-S05 reads it).
 */
const TENANT_PARAMETER = /:(installationId|repositoryId|documentId|signatureId|entryId)(?!\w)/i;

function isTenantDeclaration(access: unknown): boolean {
  return (
    access === 'tenant' ||
    (typeof access === 'object' && access !== null && 'kind' in access && access.kind === 'tenant')
  );
}

/** What is wrong with a value that is not a declaration (or is missing). */
function malformedProblem(name: string, access: unknown): string {
  if (access === undefined) {
    return `route ${name} declares no config.access`;
  }
  return isTenantDeclaration(access)
    ? `route ${name} is a tenant route and must declare its mode, 'read' or 'write', and its resolver (tenantAccess)`
    : `route ${name} declares a config.access that is not one of ${ACCESS_KINDS.join(', ')}`;
}

/** The kinds of route that have no tenant: a tenant parameter in the path of one of them is a tenant route that forgot its guard. */
const TENANTLESS_KINDS: readonly string[] = ['authenticated', 'operator', 'public'];

/** What is wrong with a declaration that is well formed, for the one route `method url`. */
function kindProblem(method: string, url: string, access: RouteAccess): string | undefined {
  const name = `${method} ${url}`;
  if (access === 'webhook') {
    return WEBHOOK_ROUTES.includes(name)
      ? undefined
      : `route ${name} declares config.access 'webhook' but is not in WEBHOOK_ROUTES`;
  }
  if (typeof access === 'string' && TENANTLESS_KINDS.includes(access)) {
    const parameter = TENANT_PARAMETER.exec(url)?.[0];
    return parameter === undefined
      ? undefined
      : `route ${name} is ${access} but its path has the tenant parameter ${parameter}; declare it as a tenant route`;
  }
  return typeof access === 'object' && access.mode === 'read' && MUTATING_METHODS.has(method)
    ? `route ${name} is a tenant route that changes data, so its mode must be 'write'`
    : undefined;
}

/**
 * What is wrong with the access declaration of one route, or `undefined` when nothing is. `access` is `unknown` on purpose:
 * a value that slipped past the types (`'admin'`, a tenant route with no mode) is caught here. A route may be
 * `webhook` only when it is on {@link WEBHOOK_ROUTES}, may not be `authenticated`, `operator` or `public` when its path
 * has a tenant parameter, and a `tenant` route that changes data must be `write`.
 */
export function accessProblem(method: string, url: string, access: unknown): string | undefined {
  const declared = accessSchema.safeParse(access);
  return declared.success ? kindProblem(method, url, declared.data) : malformedProblem(`${method} ${url}`, access);
}
