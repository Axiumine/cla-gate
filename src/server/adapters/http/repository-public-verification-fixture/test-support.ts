// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import {
  BADGE_SNIPPET_PATH,
  badgeSnippetResponseSchema,
  PUBLIC_VERIFICATION_PATH,
  publicVerificationResponseSchema,
} from '../../../../shared/public-verification.ts';
import type { PersonName } from '../../db/tenant-fixture/test-support.ts';
import { auditRows, type DocumentWorld, documentWorld, parsed } from '../document-fixture/test-support.ts';
import { pointAt, publish } from '../repository-document-fixture/test-support.ts';

// The helpers of the tests of `PUT /api/installations/:installationId/repositories/:repositoryId/public-verification` (E22-S02), on the
// world of the documents tests: two tenants, five people, the real app on PGlite. Tenant 1 has the plain repository `org-1/repo` (GitHub id
// 9000; no document attached, so only an org admin may change its settings) and `org-1/scoped`, whose own document is not published;
// tenant 2 has the same. The opt-in is off everywhere to begin with.

/** The path of the opt-in of the repository `repositoryId` (`repositories.id`) of the installation `installationId` (`installations.id`). */
const optInPath = (installationId: number | string, repositoryId: number | string): string =>
  PUBLIC_VERIFICATION_PATH.replace(':installationId', String(installationId)).replace(
    ':repositoryId',
    String(repositoryId),
  );

/** The repository and the installation a call names in its path, which are the ones of tenant 1 unless a test crosses them. */
interface OptInTarget {
  readonly installationId: number | string;
  readonly repositoryId: number | string;
}

/** Sends `body` as the body of the call as `who`, naming the installation and the repository of `target` in the path. */
export function optInAt(world: DocumentWorld, who: PersonName | null, target: OptInTarget, body: object) {
  return world.ask(who, { method: 'PUT', url: optInPath(target.installationId, target.repositoryId), payload: body });
}

/** Sends `body` as the body of the call as `who`, for the repository `repositoryId` of tenant 1 under tenant 1's installation. */
export function optInAs(world: DocumentWorld, who: PersonName | null, repositoryId: number | string, body: object) {
  return optInAt(world, who, { installationId: world.t1.installationId, repositoryId }, body);
}

/** The answer of a call that succeeded, read with the shared schema. */
export const optInAnswerOf = (response: { json: () => unknown }) => parsed(response, publicVerificationResponseSchema);

/** The same world as the documents tests, with nothing else in it: `documentWorld`. */
export const optInWorld = (): Promise<DocumentWorld> => documentWorld();

/** The stored flag and `updated_at` of a repository. */
export function optInState(world: DocumentWorld, repositoryId: number) {
  return world.db
    .selectFrom('repositories')
    .select(['public_verification', 'updated_at'])
    .where('id', '=', repositoryId)
    .executeTakeFirstOrThrow();
}

/** The `repository.public_verification_changed` audit rows for the repository with GitHub id `githubRepoId`, oldest first. */
export async function optInAuditRows(world: DocumentWorld, githubRepoId: number) {
  return (await auditRows(world, 'repository.public_verification_changed')).filter(
    (row) => row.subject_id === githubRepoId,
  );
}

/** The scoped repository of tenant 1 points at its own published document, so that the admin of that repository is the one who may change its settings. */
export async function ownDocumentOnScoped(world: DocumentWorld): Promise<void> {
  const { scoped } = world.t1;
  await publish(world, scoped.documentId);
  await pointAt(world, scoped.repositoryId, scoped.documentId);
}

/** The path of the badge snippet of the repository `repositoryId` of the installation `installationId` (E22-S03). */
const snippetPath = (installationId: number | string, repositoryId: number | string): string =>
  BADGE_SNIPPET_PATH.replace(':installationId', String(installationId)).replace(':repositoryId', String(repositoryId));

/** Asks for the badge snippet as `who`, naming the installation and the repository of `target` in the path (E22-S03). */
export function snippetAt(world: DocumentWorld, who: PersonName | null, target: OptInTarget) {
  return world.ask(who, { method: 'GET', url: snippetPath(target.installationId, target.repositoryId) });
}

/** Asks for the badge snippet as `who`, for the repository `repositoryId` of tenant 1 under tenant 1's installation (E22-S03). */
export function snippetAs(world: DocumentWorld, who: PersonName | null, repositoryId: number | string) {
  return snippetAt(world, who, { installationId: world.t1.installationId, repositoryId });
}

/** The answer of a snippet call that succeeded, read with the shared schema (E22-S03). */
export const snippetOf = (response: { json: () => unknown }) => parsed(response, badgeSnippetResponseSchema);

/** Turns the public check on for a repository past the routes, as the opt-in would leave it. */
export async function optedIn(world: DocumentWorld, repositoryId: number, enabled = true): Promise<void> {
  await world.db
    .updateTable('repositories')
    .set({ public_verification: enabled })
    .where('id', '=', repositoryId)
    .execute();
}
