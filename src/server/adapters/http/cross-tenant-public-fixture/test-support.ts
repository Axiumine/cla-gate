// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { BADGE_SNIPPET_PATH, PUBLIC_VERIFICATION_PATH } from '../../../../shared/public-verification.ts';
import type { CrossTenantCase } from '../cross-tenant-fixture/test-support.ts';
import { enforcing } from '../cross-tenant-prepare/test-support.ts';

// The entry of the cross-tenant route matrix (E11-S06) for the opt-in of a repository to the public signature check (E22-S02), kept in a
// file of its own so that the table stays under the size cap. It is a write about a repository whose path names the installation too, so the
// matrix crosses the ids: the admin of either tenant, asking with the installation of one and the repository of the other, is told what is
// told for an id that exists nowhere. The role matrix is that of the other settings of a repository: the policy is the scope of the document
// the repository enforces, which `enforcing` gives the repository of the case, so the admin of the repository passes and, for the plain
// repository, only an org admin does. The snippet of the README badge (E22-S03) is a read about the same repository under the same role
// rule, so it has the same path shape and the same crossed ids; `opted` turns the opt-in on first, because while it is off the answer is 409.

/** Makes the snippet call succeed whoever asks first (E22-S03): the repository enforces its own published CLA, as for the opt-in, and its maintainers opted in. */
const opted: NonNullable<CrossTenantCase['prepare']> = async (db, target) => {
  await enforcing(db, target);
  await db
    .updateTable('repositories')
    .set({ public_verification: true })
    .where('id', '=', target.repositoryId)
    .execute();
};

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
  [`GET ${BADGE_SNIPPET_PATH}`]: {
    endpointClass: 'repository_read',
    prepare: opted,
    request: (target) => ({
      method: 'GET',
      url: BADGE_SNIPPET_PATH.replace(':installationId', String(target.installationId)).replace(
        ':repositoryId',
        String(target.repositoryId),
      ),
    }),
  },
};
