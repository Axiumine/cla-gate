// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { SIGNATURES_PATH } from '../../../../shared/signature-search.ts';
import type { CrossTenantCase } from '../cross-tenant-fixture/test-support.ts';

// The cases of the routes of epic E15 (revocation, overrides and pending pull requests) for the route matrix (E11-S06). They sit in a
// file of their own so that the fixture of the matrix stays under the size cap, as the cases of the sign routes do
// (`cross-tenant-sign-fixture`). The fixture spreads them into `CROSS_TENANT_CASES` before the erasure cases, which come last.

/**
 * The cases of E15, keyed `METHOD path`. E15-S02: any role in the installation searches the signatures, each person the documents
 * their role reaches (a repository admin the ones scoped to a repository they administer), so the class is the one of the list of
 * repositories (E14-S01): the admin of a repository passes and nobody who holds a role is told `403`.
 */
export const REVOCATION_CASES: Readonly<Record<string, CrossTenantCase>> = {
  [`GET ${SIGNATURES_PATH}`]: {
    endpointClass: 'installation_role_read',
    request: (target) => ({
      method: 'GET',
      url: SIGNATURES_PATH.replace(':installationId', String(target.installationId)),
    }),
  },
};
