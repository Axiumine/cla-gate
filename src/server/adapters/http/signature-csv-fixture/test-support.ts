// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { SIGNATURES_CSV_PATH } from '../../../../shared/signature-export.ts';
import type { PersonName } from '../../db/tenant-fixture/test-support.ts';
import { CLA_TEXT, publishVersion, sha256 } from '../../db/test-support.ts';
import { matrixWorld } from '../cross-tenant-runner/test-support.ts';

// The world of the signature CSV route tests (E16-S03): the two tenants of the cross-tenant matrix with five people who are
// logged in, and a call of the export as one of them.

/** The path of the export of one document of one installation. */
export const csvPathOf = (installationId: number, documentId: number): string =>
  SIGNATURES_CSV_PATH.replace(':installationId', String(installationId)).replace(':documentId', String(documentId));

/**
 * The matrix world with `get(who, installationId, documentId, query)`: the export as that person (nobody: no session). `app` adds
 * the options of the app a test sets (the queue a new signature sends its evaluations to, E15-S02).
 */
export async function csvWorld(app: Parameters<typeof matrixWorld>[1] = {}) {
  const state = await matrixWorld({}, app);
  const get = (who: PersonName | null, installationId: number, documentId: number, query = '') =>
    state.ask(who, { method: 'GET', url: `${csvPathOf(installationId, documentId)}${query}` });
  /** What `seedSignatures` needs for the repository-scoped document of tenant 1, which the seed leaves without a version. */
  const scopedTarget = async () => {
    const { t1 } = state;
    const version = await publishVersion(state.db, t1.scoped.documentId, t1.publisherId, {
      major: 1,
      minor: 0,
      text: CLA_TEXT,
    });
    return {
      installationId: t1.installationId,
      documentId: t1.scoped.documentId,
      versionId: version.id,
      contentSha256: sha256(CLA_TEXT),
      repositoryId: t1.scoped.repositoryId,
    };
  };
  return { ...state, get, scopedTarget };
}
