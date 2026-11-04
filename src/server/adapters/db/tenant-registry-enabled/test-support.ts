// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { parseGithubId } from '../../../../shared/github-id.ts';
import { RepositoryNotFoundError, setRepositoryEnabled } from '../../../services/repository-enabled.ts';
import { ownersOfGithubIds } from '../tenant-owners/test-support.ts';
import type { ScopedQuery } from '../tenant-registry/test-support.ts';

// The entry of the registry of the tenant data access (E11-S06) for the change of the enforcement flag, kept in a file of its own so
// that the registry stays under the size cap (E14-S04). `TENANT_QUERIES` has it under `services/repository-enabled.ts`.

/** The only export of `services/repository-enabled.ts` that runs a statement: the flag and its audit row, for the plain repository. */
export const ENABLED_WRITES: Readonly<Record<string, ScopedQuery>> = {
  setRepositoryEnabled: {
    kind: 'scoped',
    takesIds: true,
    activeOnly: true,
    refusal: (error) => error instanceof RepositoryNotFoundError,
    run: async (db, scope, ids) => {
      const { changed } = await setRepositoryEnabled(db, {
        installationId: scope.installationId,
        githubRepoId: ids.plain.githubRepoId,
        enabled: true,
        actorGithubId: parseGithubId(1),
      });
      return changed ? ownersOfGithubIds(db, [ids.plain.githubRepoId]) : [];
    },
  },
};
