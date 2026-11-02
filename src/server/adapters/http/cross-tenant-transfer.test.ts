// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { createAdmissionPolicies } from '../../services/admission-policies.ts';
import { findDocumentPlacement, findSignaturePlacement } from '../../services/document-placement.ts';
import { createInstallationAdmission } from '../../services/installation-admission.ts';
import type { SyncContext } from '../../services/installation-sync-model.ts';
import { reconcile } from '../../services/installation-sync-write.ts';
import type { GitHubRepository } from '../../services/ports/github.ts';
import { captureLogs } from '../../test-support.ts';
import type { InstallationRowId } from '../db/installation-row-id.ts';
import { assertRepositoryInTenant, TenantMismatchError } from '../db/tenant-scope.ts';
import { matrixWorld } from './cross-tenant-runner/test-support.ts';
import { createLogger } from './logger.ts';
import { tenantAccess } from './tenant-access.ts';
import { shapeOf } from './tenant-guard-fixture/test-support.ts';
import { byDocumentParam, byRepositoryParam, bySignatureParam } from './tenant-resolvers.ts';

// A repository moves between two admitted tenants (E05-S09, E11-S07). Whichever tenant syncs first, the old tenant keeps its
// row, its documents and its signatures, the new tenant gets a new row with nothing attached, and neither tenant's admin
// can reach the other's rows with the ids of the other. The two sync events are run through the repository half of the
// real sync (`reconcile`) in both orders.

const ORDERS = [
  ['the old tenant syncs before the new one', ['old', 'new']],
  ['the new tenant syncs before the old one', ['new', 'old']],
] as const;

type Event = 'old' | 'new';

const NEW_NAME = 'org-2/moved';

/** The world of the matrix with three read routes under `/x`, each answering `request.tenant`. */
async function world() {
  const matrix = await matrixWorld();
  const { app, db, t1, t2 } = matrix;
  const routes = [
    ['repositories/:repositoryId', byRepositoryParam(db)],
    ['documents/:documentId', byDocumentParam(db)],
    ['signatures/:signatureId', bySignatureParam(db)],
  ] as const;
  for (const [path, resolve] of routes) {
    app.get(
      `/x/installations/:installationId/${path}`,
      { config: { access: tenantAccess({ mode: 'read', resolve }) } },
      (request) => ({
        tenant: request.tenant,
      }),
    );
  }
  const logger = createLogger({ logLevel: 'info' }, captureLogs().destination);
  const context: SyncContext = {
    db,
    clock: matrix.clock,
    logger,
    admission: createInstallationAdmission({
      db,
      clock: matrix.clock,
      logger,
      policies: createAdmissionPolicies({
        configured: [],
        ownerAccountId: () => Promise.resolve(parseGithubId(9001)),
        logger,
      }),
    }),
  };
  const listed = (...repositories: readonly { githubRepoId: number; fullName: string }[]): GitHubRepository[] =>
    repositories.map((repository) => ({ id: parseGithubId(repository.githubRepoId), fullName: repository.fullName }));
  const sync = (installationId: InstallationRowId, repositories: GitHubRepository[]) =>
    db.transaction().execute((trx) => reconcile(context, trx, installationId, repositories));
  /** What GitHub lists after the move, for the sync event of each tenant: `org-1/scoped` is now `org-2/moved`. */
  const syncEvent = (event: Event) =>
    event === 'old'
      ? sync(t1.installationId, listed(t1.plain))
      : sync(
          t2.installationId,
          listed(t2.plain, t2.scoped, { githubRepoId: t1.scoped.githubRepoId, fullName: NEW_NAME }),
        );
  return { ...matrix, syncEvent };
}

/** The world after the move, the two tenants having synced in `order`, a minute apart. */
async function afterTransfer(order: readonly Event[]) {
  const w = await world();
  for (const event of order) {
    w.clock.advance(60_000);
    await w.syncEvent(event);
  }
  const rows = await w.db
    .selectFrom('repositories')
    .select(['id', 'installation_id', 'removed_at'])
    .where('github_repo_id', '=', w.t1.scoped.githubRepoId)
    .execute();
  const oldRow = rows.find((row) => row.installation_id === w.t1.installationId);
  const newRow = rows.find((row) => row.installation_id === w.t2.installationId);
  if (oldRow === undefined || newRow === undefined) {
    throw new Error('the repository has no row under one of the tenants');
  }
  const get = (who: 'admin1' | 'admin2' | 'repoAdmin1', url: string) => w.ask(who, { method: 'GET', url });
  const unknown = shapeOf(await get('admin1', '/x/installations/987654/repositories/987654'));
  return { ...w, oldRow, newRow, get, unknown };
}

test.each(ORDERS)(
  '%s: the old tenant keeps a removed row and the new tenant has an active one',
  async (_label, order) => {
    const w = await afterTransfer(order);
    expect(w.oldRow.removed_at).not.toBeNull();
    expect(w.newRow.removed_at).toBeNull();
    expect(w.oldRow.id).not.toBe(w.newRow.id);
  },
);

test.each(ORDERS)(
  "%s: each tenant's admin gets the 404 of an unknown id for the row of the other",
  async (_label, order) => {
    const w = await afterTransfer(order);
    const repository = (installation: InstallationRowId, row: { id: number }) =>
      `/x/installations/${installation}/repositories/${row.id}`;
    // The old tenant's admin, asking for the new tenant's row, with their own installation and with the new tenant's.
    expect(shapeOf(await w.get('admin1', repository(w.t1.installationId, w.newRow)))).toEqual(w.unknown);
    expect(shapeOf(await w.get('admin1', repository(w.t2.installationId, w.newRow)))).toEqual(w.unknown);
    // The new tenant's admin, asking for the old row, the same.
    expect(shapeOf(await w.get('admin2', repository(w.t2.installationId, w.oldRow)))).toEqual(w.unknown);
    expect(shapeOf(await w.get('admin2', repository(w.t1.installationId, w.oldRow)))).toEqual(w.unknown);
    // The old tenant's own row has left the installation, so it is a 404 for its admin too; the new tenant's admin reads theirs.
    expect(shapeOf(await w.get('admin1', repository(w.t1.installationId, w.oldRow)))).toEqual(w.unknown);
    const own = await w.get('admin2', repository(w.t2.installationId, w.newRow));
    expect([own.statusCode, own.json()]).toEqual([
      200,
      { tenant: { installationId: w.t2.installationId, repositoryId: w.newRow.id, role: 'org_admin' } },
    ]);
  },
);

test.each(ORDERS)(
  '%s: a signature and a document of the old tenant are not found under the new one, and stay with the old one for its org admin',
  async (_label, order) => {
    const w = await afterTransfer(order);
    const documents = `/x/installations/${w.t2.installationId}/documents/${w.t1.scoped.documentId}`;
    const signatures = `/x/installations/${w.t2.installationId}/signatures/${w.t1.signatureId}`;
    expect(shapeOf(await w.get('admin2', documents))).toEqual(w.unknown);
    expect(shapeOf(await w.get('admin2', signatures))).toEqual(w.unknown);
    // The old tenant keeps them, immutable. The repository the document was made for left, so only an org admin reaches it.
    const kept = [
      `/x/installations/${w.t1.installationId}/documents/${w.t1.scoped.documentId}`,
      `/x/installations/${w.t1.installationId}/signatures/${w.t1.signatureId}`,
    ];
    for (const url of kept) {
      const answer = await w.get('admin1', url);
      expect([answer.statusCode, answer.json()]).toEqual([
        200,
        { tenant: { installationId: w.t1.installationId, repositoryId: null, role: 'org_admin' } },
      ]);
    }
    expect(shapeOf(await w.get('repoAdmin1', kept[0] ?? ''))).toEqual(w.unknown);
  },
);

test.each(ORDERS)("%s: the new tenant's queries never return the old tenant's rows", async (_label, order) => {
  const w = await afterTransfer(order);
  const scope = { installationId: w.t2.installationId };
  const signatures = await w.db
    .selectFrom('signatures')
    .select('id')
    .where('installation_id', '=', w.t2.installationId)
    .execute();
  expect(signatures.map((row) => row.id)).toEqual([w.t2.signatureId]);
  expect(await findSignaturePlacement(w.db, scope, w.t1.signatureId)).toBeNull();
  expect(await findDocumentPlacement(w.db, scope, w.t1.scoped.documentId)).toBeNull();
  const attached = await w.db
    .selectFrom('repositories')
    .select(['enabled', 'cla_document_id'])
    .where('id', '=', w.newRow.id)
    .executeTakeFirstOrThrow();
  expect(attached).toEqual({ enabled: false, cla_document_id: null });
  // A job for one tenant cannot write the repository row of the other.
  await expect(assertRepositoryInTenant(w.db, scope, w.oldRow.id)).rejects.toBeInstanceOf(TenantMismatchError);
  await expect(
    assertRepositoryInTenant(w.db, { installationId: w.t1.installationId }, w.newRow.id),
  ).rejects.toBeInstanceOf(TenantMismatchError);
  await assertRepositoryInTenant(w.db, { installationId: w.t1.installationId }, w.oldRow.id);
});
