// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { PUBLIC_VERIFICATION_PATH } from '../../../../shared/public-verification.ts';
import type { CrossTenantCase } from '../cross-tenant-fixture/test-support.ts';
import { enforcing } from '../cross-tenant-prepare/test-support.ts';

// The entry of the cross-tenant route matrix (E11-S06) for the opt-in of a repository to the public signature check (E22-S02), kept in a
// file of its own so that the table stays under the size cap. It is a write about a repository whose path names the installation too, so the
// matrix crosses the ids: the admin of either tenant, asking with the installation of one and the repository of the other, is told what is
// told for an id that exists nowhere. The role matrix is that of the other settings of a repository: the policy is the scope of the document
// the repository enforces, which `enforcing` gives the repository of the case, so the admin of the repository passes and, for the plain
// repository, only an org admin does.

export const PUBLIC_VERIFICATION_CASES: Readonly<Record<string, CrossTenantCase>> = {
  [`PUT ${PUBLIC_VERIFICATION_PATH}`]: {
    endpointClass: 'repository_write',
    prepare: enforcing,
    request: (target) => ({
      method: 'PUT',
      url: PUBLIC_VERIFICATION_PATH.replace(':installationId', String(target.installationId)).replace(
        ':repositoryId',
        String(target.repositoryId),
      ),
      payload: { enabled: true },
    }),
  },
};
