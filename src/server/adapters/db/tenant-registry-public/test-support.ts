// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { parseGithubId } from '../../../../shared/github-id.ts';
import { ClaRuleError } from '../../../services/cla-rule-error.ts';
import { findPublicRepository, hasCountingSignature } from '../../../services/public-verification-queries.ts';
import { setPublicVerification } from '../../../services/repository-public-verification.ts';
import { ownersOfRepositories, ownersOfSignatures } from '../tenant-owners/test-support.ts';
import type { TenantQuery } from '../tenant-registry/test-support.ts';

// The registry entries (E11-S06) of the statements of the public signature check (E22-S02): the read that finds the repository a
// public call names, the read of the signature that counts, and the change of the opt-in flag. They sit in a file of their own so that
// the registry stays under the size cap. The seed gives each tenant one signer with one signature on the tenant's document at major 1.

/** Every function of the public signature check statements, by module and name. */
export const PUBLIC_TENANT_QUERIES: Readonly<Record<string, Readonly<Record<string, TenantQuery>>>> = {
  'services/public-verification-queries.ts': {
    findPublicRepository: {
      kind: 'by_design',
      reason:
        "the public call names a repository by GitHub's id and nothing else (E22-S02), with no session to tell the tenant, so the tenant is found from it: the statement reads the one active repository under that id with the state of its installation and answers no list; the caller turns a repository that may not be asked about into the same 404 as an unknown one",
      pinnedBy: 'services/public-verification-queries.test.ts',
      run: async (db, _scope, ids) => (await findPublicRepository(db, ids.plain.githubRepoId))?.installationId,
      answers: (own, other) => ({ own: own.installationId, foreign: other.installationId }),
    },
    hasCountingSignature: {
      kind: 'scoped',
      takesIds: true,
      activeOnly: false,
      run: async (db, scope, ids) =>
        (await hasCountingSignature(db, scope, { documentId: ids.documentId, githubId: ids.signer.githubId }))
          ? ownersOfSignatures(db, [ids.signatureId])
          : [],
    },
  },
  'services/repository-public-verification.ts': {
    setPublicVerification: {
      kind: 'scoped',
      takesIds: true,
      activeOnly: true,
      // A repository the tenant does not have is a row the locking read finds none of: the call refuses with `not_found`.
      refusal: (error) => error instanceof ClaRuleError && error.rule === 'not_found',
      run: async (db, scope, ids) => {
        await setPublicVerification(db, scope, {
          repositoryId: ids.plain.repositoryId,
          role: 'org_admin',
          actorGithubId: parseGithubId(1),
          enabled: true,
        });
        return ownersOfRepositories(db, [ids.plain.repositoryId]);
      },
    },
  },
};
