// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { parseGithubId } from '../../../shared/github-id.ts';
import { TenantMismatchError } from '../../adapters/db/tenant-scope.ts';
import type { MergeGroupResult } from '../../domain/reporting/check-view.ts';
import { findInstallationByGithubId } from '../installation-queries.ts';
import { recordGroupCheckRun } from '../merge-group/merge-group-progress.ts';
import { findGroupRow, GroupRowMissingError, MergeGroupDestroyedError } from '../merge-group/merge-group-rows.ts';
import type { MergeGroupTarget } from '../ports/reporter.ts';
import { findRepositoryByGithubId } from '../repository-queries.ts';
import type { RunLocator } from './check-run-writer.ts';
import type { CheckRunReporterOptions } from './report-options.ts';
import { logReport } from './report-record.ts';
import { locationOf } from './report-situation.ts';
import { writeRun } from './report-write.ts';

// The report on a merge group (E22-S01): the Check Run `license/cla` on the head SHA of the group, written through the same upsert
// as the Check Run of a pull request (E09-S05, with the 422 fallback of E09-S06). The run belongs to the head SHA of the group:
// the SHA written is always `target.headSha`, whatever head SHAs the pull requests of the group have. The id of the run is kept
// on the row of the group, which is found through the tenant (the installation of the target), never by the SHA alone.

/**
 * Writes the verdict `result` to the Check Run of the group of `target` and records the id of the run on the row of the group.
 * @throws TenantMismatchError for an installation or repository the database does not hold together, GroupRowMissingError when the
 * group has no row, MergeGroupDestroyedError when GitHub took the group down (nothing is written), and what the writer throws.
 */
export async function reportMergeGroup(
  options: CheckRunReporterOptions,
  target: MergeGroupTarget,
  result: MergeGroupResult,
): Promise<void> {
  const installation = await findInstallationByGithubId(options.db, target.githubInstallationId);
  const repository =
    installation === null ? null : await findRepositoryByGithubId(options.db, installation.id, target.githubRepoId);
  if (installation === null || repository === null) {
    throw new TenantMismatchError();
  }
  const row = await findGroupRow(options.db, {
    installationId: installation.id,
    repositoryId: repository.id,
    headSha: target.headSha,
  });
  if (row === null) {
    throw new GroupRowMissingError();
  }
  // The last look at the group before the write: the row is read here, after the reads above and before the one GitHub call that
  // writes, so a group taken down while the report was prepared gets no run.
  if (row.destroyedAt !== null) {
    throw new MergeGroupDestroyedError();
  }
  const locator: RunLocator = {
    ...locationOf(target),
    ...(row.checkRunId === null ? {} : { existingId: parseGithubId(row.checkRunId) }),
  };
  const checkRunId = await writeRun(options, target, {
    ...locator,
    view: { kind: 'merge_group', headSha: target.headSha, result },
    externalId: String(row.id),
  });
  if (row.checkRunId !== checkRunId) {
    await recordGroupCheckRun(options.db, installation.id, row.id, checkRunId);
  }
  logReport(options.logger, target, checkRunId, 'report.merge_group');
}
