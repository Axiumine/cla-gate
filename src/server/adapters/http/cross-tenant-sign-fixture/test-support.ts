// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { signResponseSchema, signRoute } from '../../../../shared/sign.ts';
import { signContextResponseSchema, signContextRoute } from '../../../../shared/sign-context.ts';
import type { IsolationCase } from '../cross-tenant-fixture/test-support.ts';

// The isolation cases of the two sign routes (E13-S02, E13-S04) for the route matrix (E11-S06). They sit in a file of their own so
// that the fixture of the matrix stays under the size cap, as the case of the own signatures does (`cross-tenant-own-signatures-fixture`).

/**
 * The sign context (E13-S02) is open to any signed-in person and answers with the document, version and signatures of the tenant
 * that holds the repository the path names. The path is the only input, so there is no id of another tenant to inject: the
 * request is the same with or without it, and the answer must be the same. The matrix makes the scoped repository of each
 * tenant enforce the tenant's document (version 1.0, signed by the tenant's signer), so tenant 1's signer is shown tenant 1's
 * document, version and own signature and nothing of tenant 2.
 */
export const SIGN_CONTEXT_CASE: IsolationCase = {
  arrange: async (db, tenants) => {
    await Promise.all(
      tenants.map((tenant) =>
        db
          .updateTable('repositories')
          .set({ cla_document_id: tenant.documentId })
          .where('id', '=', tenant.scoped.repositoryId)
          .execute(),
      ),
    );
  },
  request: (own) => ({
    method: 'GET',
    url: signContextRoute.path.replace(':githubRepoId', String(own.githubRepoId)),
  }),
  rows: (body) => {
    const context = signContextResponseSchema.parse(body);
    return [
      { table: 'cla_documents' as const, id: context.document.id },
      { table: 'cla_versions' as const, id: context.version.id },
      ...(context.signature === null ? [] : [{ table: 'signatures' as const, id: context.signature.id }]),
    ];
  },
  mayShow: (owner, viewer) =>
    owner.installationId === viewer.own.installationId && (owner.userId === null || owner.userId === viewer.userId),
};

/** The version in force and its hash for the repository of each tenant, by GitHub's id of the repository, as `SIGN_CASE` arranged them. */
const SIGN_TARGETS = new Map<number, { readonly versionId: number; readonly contentSha256: string }>();

/**
 * The sign request (E13-S04) is open to any signed-in person and writes to the tenant that holds the repository its body names.
 * The body is the only input, and it is strict, so there is no id of another tenant to inject: the request is the same with or
 * without it, and the answer must be the same (the cases that put a version of one tenant into the request of another are in
 * sign-routes-tenants.test.ts). The matrix makes the scoped repository of each tenant enforce the tenant's document, gives every
 * session a verified address, and asks as the two signers of the world, who signed version 1.0 of their own tenant's document
 * already: the answer is the repeat (`200`, `created: false`) with the signature each of them has, so that the call can be made
 * more than once and writes nothing, and what it names is that signature and no other.
 */
export const SIGN_CASE: IsolationCase = {
  arrange: async (db, tenants) => {
    await Promise.all(
      tenants.map(async (tenant) => {
        SIGN_TARGETS.set(tenant.scoped.githubRepoId, {
          versionId: tenant.versionId,
          contentSha256: tenant.contentSha256,
        });
        await db
          .updateTable('repositories')
          .set({ cla_document_id: tenant.documentId })
          .where('id', '=', tenant.scoped.repositoryId)
          .execute();
      }),
    );
    await db
      .updateTable('sessions')
      .set({ verified_emails: JSON.stringify([{ email: 'ada@example.org', primary: true }]) })
      .execute();
  },
  request: (own) => ({
    method: 'POST',
    url: signRoute.path,
    payload: {
      githubRepoId: own.githubRepoId,
      ...SIGN_TARGETS.get(own.githubRepoId),
      consentTextId: 'individual-v1',
      name: 'Ada Lovelace',
      email: 'ada@example.org',
    },
  }),
  rows: (body) => [{ table: 'signatures' as const, id: signResponseSchema.parse(body).signature.id }],
  mayShow: (owner, viewer) => owner.installationId === viewer.own.installationId && owner.userId === viewer.userId,
};
