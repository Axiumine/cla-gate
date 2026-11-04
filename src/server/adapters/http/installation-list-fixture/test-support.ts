// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { z } from 'zod';
import { errorResponseSchema } from '../../../../shared/errors.ts';
import {
  INSTALLATION_REPOSITORIES_PATH,
  INSTALLATIONS_PATH,
  installationListSchema,
  repositoryPageSchema,
} from '../../../../shared/installations.ts';
import { createInstallationStore } from '../../../services/installation-store.ts';
import { listed } from '../../../services/store-fixture/test-support.ts';
import type { InstallationRowId } from '../../db/installation-row-id.ts';
import { sha256 } from '../../db/test-support.ts';
import type { GuardWorld, Person } from '../tenant-guard-fixture/test-support.ts';

// What the tests of the lists of E14-S01 share: the world of the tenant guard tests (six tenants, three repositories each,
// roles told by an in-memory GitHub; see tenant-guard-fixture/test-support.ts) and the few helpers that read an answer of the
// two routes and change what they list. Tenant 1 is the one under test: its `repo-1` and `repo-2` carry a repo-scoped document
// (`repoAdmin1` administers `repo-1`, `repoAdminOther` `repo-2`), its `repo-3` is removed and `admin1` is the admin of its organisation.

/** The path of the repository list of the installation `installationId`, with `query` (a `?…` string) after it. */
const repositoriesPath = (installationId: number, query = ''): string =>
  `${INSTALLATION_REPOSITORIES_PATH.replace(':installationId', String(installationId))}${query}`;

/** The body of a response read with `schema`, so a body of another shape fails the test here and is typed from there on. */
export function bodyOf<T>(response: { json: () => unknown }, schema: z.ZodType<T>): T {
  return schema.parse(response.json());
}

/** `[status, code]` of an error response, the code read with the shared schema so a different shape fails here. */
export function failureOf(response: { statusCode: number; json: () => unknown }): [number, string] {
  return [response.statusCode, bodyOf(response, errorResponseSchema).error.code];
}

/**
 * What `GET /api/installations` answers `person`, asked `times` times with 61 seconds between one answer and the next ask: the role
 * cache holds an answer for 60, so each ask is made with nothing cached. The status and the rows (the account and `truncated`) of each.
 */
export async function listMinutesApart(world: GuardWorld, person: Person, times: number) {
  const answers = [];
  for (let ask = 0; ask < times; ask += 1) {
    const response = await world.ask('GET', INSTALLATIONS_PATH, person);
    answers.push([
      response.statusCode,
      bodyOf(response, installationListSchema).map((row) => [row.accountLogin, row.truncated]),
    ]);
    world.advance(61);
  }
  return answers;
}

/** The full names of a page of the repository list, in order. */
export function namesOfPage(response: { json: () => unknown }): string[] {
  return bodyOf(response, repositoryPageSchema).items.map((item) => item.fullName);
}

/** Asks for the repository list of `installationId` as `person`; `query` is a `?…` string. */
export function listRepositories(world: GuardWorld, person: Person | undefined, installationId: number, query = '') {
  return world.ask('GET', repositoriesPath(installationId, query), person);
}

/**
 * Stores repositories named exactly as given for the installation of tenant `n` (`org-<n>`), as a sync would, with GitHub ids
 * from `n * 10000 + 100` on, and answers their `repositories.id` by name.
 */
export async function storeRepositories(
  world: GuardWorld,
  tenant: { readonly n: number; readonly installationId: InstallationRowId },
  fullNames: readonly string[],
): Promise<Map<string, number>> {
  await createInstallationStore(world.db).upsertRepositories(
    tenant.installationId,
    fullNames.map((fullName, index) => listed(tenant.n, 100 + index, fullName)),
  );
  const rows = await world.db
    .selectFrom('repositories')
    .select(['id', 'full_name'])
    .where('installation_id', '=', tenant.installationId)
    .where('full_name', 'in', fullNames)
    .execute();
  return new Map(rows.map((row) => [row.full_name, row.id]));
}

/** Makes `repositoryId` enforce the document `documentId`, or none when it is null (the database holds the attachment; E14-S02 writes it). */
export async function attachDocument(world: GuardWorld, repositoryId: number, documentId: number | null) {
  await world.db
    .updateTable('repositories')
    .set({ cla_document_id: documentId })
    .where('id', '=', repositoryId)
    .execute();
}

/** A document to store: its name, the repository it is scoped to (null for the whole installation) and the version it has active, if any. */
export interface DocumentSpec {
  readonly name: string;
  readonly repositoryId: number | null;
  readonly active?: { readonly major: number; readonly minor: number };
}

/** Stores a document of tenant `installationId` as `spec` says, past the routes, and answers its `cla_documents.id`. */
export async function storeDocument(
  world: GuardWorld,
  installationId: InstallationRowId,
  spec: DocumentSpec,
): Promise<number> {
  const document = await world.db
    .insertInto('cla_documents')
    .values({
      installation_id: installationId,
      repository_id: spec.repositoryId,
      name: spec.name,
      kind: 'individual',
      active_version_id: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  if (spec.active !== undefined) {
    const publisher = await world.db.selectFrom('users').select('id').executeTakeFirstOrThrow();
    const text = `Text of ${spec.name}`;
    const version = await world.db
      .insertInto('cla_versions')
      .values({
        document_id: document.id,
        major: spec.active.major,
        minor: spec.active.minor,
        content_md: text,
        content_sha256: sha256(text),
        published_by: publisher.id,
        rationale: 'Because',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await world.db
      .updateTable('cla_documents')
      .set({ active_version_id: version.id })
      .where('id', '=', document.id)
      .execute();
  }
  return document.id;
}
