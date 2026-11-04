// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import {
  REPOSITORY_CLA_DOCUMENT_PATH,
  repositoryDocumentResponseSchema,
} from '../../../../shared/repository-document.ts';
import { recordAdminSeen } from '../../../services/admin-ledger-queries.ts';
import type { PersonName } from '../../db/tenant-fixture/test-support.ts';
import { sha256 } from '../../db/test-support.ts';
import { type DocumentWorld, parsed } from '../document-fixture/test-support.ts';

// The helpers of the tests of `PUT /api/repositories/:repositoryId/cla-document` (E14-S02), on the world of the documents tests:
// two tenants, five people, the real app on PGlite. Tenant 1 has the plain repository `org-1/repo` (no document, not enforcing) with
// the installation-wide document `Individual CLA` (published), and `org-1/scoped` (enforcing, no document attached) with the
// repository document `Repository CLA` (not published); tenant 2 has the same.

/** The path of the CLA document of the repository `repositoryId` (`repositories.id`). */
export const attachPath = (repositoryId: number | string): string =>
  REPOSITORY_CLA_DOCUMENT_PATH.replace(':repositoryId', String(repositoryId));

/** Sends `body` as the body of the call that changes the CLA of a repository, as `who`. */
export function attachBody(world: DocumentWorld, who: PersonName | null, repositoryId: number | string, body: object) {
  return world.ask(who, { method: 'PUT', url: attachPath(repositoryId), payload: body });
}

/** Attaches the document `documentId` to a repository as `who`, or detaches the one it has (`null`). */
export function attachAs(
  world: DocumentWorld,
  who: PersonName | null,
  repositoryId: number | string,
  documentId: number | null,
) {
  return attachBody(world, who, repositoryId, { documentId });
}

/** The answer of a call that succeeded, read with the shared schema. */
export const answerOf = (response: { json: () => unknown }) => parsed(response, repositoryDocumentResponseSchema);

/** The stored pointer and enforcement flag of a repository. */
export function repositoryState(world: DocumentWorld, repositoryId: number) {
  return world.db
    .selectFrom('repositories')
    .select(['cla_document_id', 'enabled', 'updated_at'])
    .where('id', '=', repositoryId)
    .executeTakeFirstOrThrow();
}

/** Turns enforcement on or off for a repository, past the routes. */
export async function setEnabled(world: DocumentWorld, repositoryId: number, enabled: boolean): Promise<void> {
  await world.db.updateTable('repositories').set({ enabled }).where('id', '=', repositoryId).execute();
}

/** Points a repository at a document, past the routes. */
export async function pointAt(world: DocumentWorld, repositoryId: number, documentId: number | null): Promise<void> {
  await world.db
    .updateTable('repositories')
    .set({ cla_document_id: documentId })
    .where('id', '=', repositoryId)
    .execute();
}

/** Publishes a version 1.0 of a document, past the routes, and points the document at it. */
export async function publish(world: DocumentWorld, documentId: number): Promise<void> {
  const text = `Terms of document ${documentId}\n`;
  const version = await world.db
    .insertInto('cla_versions')
    .values({
      document_id: documentId,
      major: 1,
      minor: 0,
      content_md: text,
      content_sha256: sha256(text),
      published_by: world.t1.publisherId,
      rationale: 'test',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await world.db
    .updateTable('cla_documents')
    .set({ active_version_id: version.id })
    .where('id', '=', documentId)
    .execute();
}

/** Stores a document of tenant 1 past the routes: installation-wide, or scoped to `repositoryId`; published when asked to be. */
export async function storeDocument(
  world: DocumentWorld,
  spec: {
    readonly name: string;
    readonly kind?: 'individual' | 'corporate';
    readonly repositoryId?: number;
    readonly published?: boolean;
  },
): Promise<number> {
  const row = await world.db
    .insertInto('cla_documents')
    .values({
      installation_id: world.t1.installationId,
      repository_id: spec.repositoryId ?? null,
      name: spec.name,
      kind: spec.kind ?? 'individual',
      active_version_id: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  if (spec.published === true) {
    await publish(world, row.id);
  }
  return row.id;
}

/**
 * Suspends the installation of tenant 1, as GitHub does when its owner suspends the App. The org admin the ledger remembers (E11-S07)
 * is brought to now, so that a refusal is the state of the tenant and not a stale ledger.
 */
export async function suspendTenantOne(world: DocumentWorld): Promise<void> {
  const now = world.clock.now();
  await recordAdminSeen(world.db, { installationId: world.t1.installationId }, world.people.admin1.githubId, {
    seenAt: now,
    refreshAtOrBefore: now,
  });
  await world.db
    .updateTable('installations')
    .set({ suspended_at: new Date('2026-10-01T00:00:00Z') })
    .where('id', '=', world.t1.installationId)
    .execute();
}
