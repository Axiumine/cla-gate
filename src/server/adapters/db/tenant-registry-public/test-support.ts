// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { parseGithubId } from '../../../../shared/github-id.ts';
import { ClaRuleError } from '../../../services/cla-rule-error.ts';
import {
  findPublicRepository,
  hasCountingSignature,
  isPublicVerificationOn,
} from '../../../services/public-verification-queries.ts';
import { setPublicVerification } from '../../../services/repository-public-verification.ts';
import { ownersOfRepositories, ownersOfSignatures } from '../tenant-owners/test-support.ts';
import type { TenantQuery } from '../tenant-registry/test-support.ts';

// The registry entries (E11-S06) of the statements of the public signature check (E22-S02): the read that finds the repository a
// public call names, the read of the signature that counts, the change of the opt-in flag, and the read of the flag for the badge snippet (E22-S03). They sit in a file of their own so that
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
    isPublicVerificationOn: {
      kind: 'scoped',
      takesIds: true,
      activeOnly: true,
      // The seed leaves the opt-in off everywhere: the opt-in is on for the plain repository of both tenants, so that a read that
      // crossed into another tenant would find a flag that is true, and the matrix would see the owner of the row.
      arrange: async (db, tenants) => {
        await db
          .updateTable('repositories')
          .set({ public_verification: true })
          .where(
            'id',
            'in',
            tenants.map((tenant) => tenant.plain.repositoryId),
          )
          .execute();
      },
      run: async (db, scope, ids) =>
        (await isPublicVerificationOn(db, scope, ids.plain.repositoryId))
          ? ownersOfRepositories(db, [ids.plain.repositoryId])
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
