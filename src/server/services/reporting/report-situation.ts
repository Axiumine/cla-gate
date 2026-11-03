// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { parseGithubId } from '../../../shared/github-id.ts';
import { EvaluationRowMissingError, findRowsForSha, type RowAtSha } from '../../adapters/db/pr-evaluation-links.ts';
import type { Database } from '../../adapters/db/schema.ts';
import { TenantMismatchError, type TenantScope } from '../../adapters/db/tenant-scope.ts';
import { findInstallationByGithubId } from '../installation-queries.ts';
import type { RunTarget } from '../ports/reporter.ts';
import { findRepositoryByGithubId } from '../repository-queries.ts';
import type { RunLocator } from './check-run-writer.ts';

// What the reporter of the evaluation job (E09-S05) reads from the database before it reports: the tenant of the target and the
// rows at its head SHA. Every query carries the installation of the tenant (a cross-tenant target is a TenantMismatchError).
// A target without a trigger (a cancellation, a repository switched off, E09-S06) is read the same way.

/** What a report needs to know of the tenant and of the rows at the head SHA, read at the time of the report. */
export interface Situation {
  readonly scope: TenantScope;
  readonly repositoryId: number;
  /** Every row at the head SHA, the row of the pull request included (`own`). */
  readonly rows: readonly RowAtSha[];
  readonly own: RowAtSha;
}

/**
 * The tenant of the target and the rows at its head SHA.
 * @throws TenantMismatchError for an installation or repository the database does not hold together, and
 * EvaluationRowMissingError when the row of the pull request at the SHA does not exist.
 */
export async function readSituation(db: Kysely<Database>, target: RunTarget): Promise<Situation> {
  const installation = await findInstallationByGithubId(db, target.githubInstallationId);
  const repository =
    installation === null ? null : await findRepositoryByGithubId(db, installation.id, target.githubRepoId);
  if (installation === null || repository === null) {
    throw new TenantMismatchError();
  }
  const scope = { installationId: installation.id };
  const rows = await findRowsForSha(db, scope, repository.id, target.headSha);
  const own = rows.find((row) => row.prNumber === target.prNumber);
  if (own === undefined) {
    throw new EvaluationRowMissingError();
  }
  return { scope, repositoryId: repository.id, rows, own };
}

/** Where the run of the target's SHA is, and the id the row of the pull request recorded for it. */
export function locatorOf(target: RunTarget, own: RowAtSha): RunLocator {
  const [owner = '', repo = ''] = target.fullName.split('/');
  return {
    githubInstallationId: target.githubInstallationId,
    owner,
    repo,
    headSha: target.headSha,
    ...(own.checkRunId === null ? {} : { existingId: parseGithubId(own.checkRunId) }),
  };
}
