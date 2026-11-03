// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import type { GithubId } from '../../../shared/github-id.ts';
import { type LinkKey, recordCheckRunId } from '../../adapters/db/pr-evaluation-links.ts';
import type { Database } from '../../adapters/db/schema.ts';
import type { ReportTarget } from '../ports/reporter.ts';
import type { Situation } from './report-situation.ts';

// What the reporter of the evaluation job (E09-S05) leaves behind after a report: the id of the run on the row of the pull
// request (E09-S04), and one log line made of numeric ids only.

/** Stores the id of the run on the row of the pull request, unless the row holds it already. */
export async function rememberRun(
  db: Kysely<Database>,
  target: ReportTarget,
  situation: Situation,
  checkRunId: GithubId,
): Promise<void> {
  if (situation.own.checkRunId === checkRunId) {
    return;
  }
  const key: LinkKey = { repositoryId: situation.repositoryId, prNumber: target.prNumber, headSha: target.headSha };
  await recordCheckRunId(db, situation.scope, key, checkRunId);
}

/** One line per report: the numeric ids, the head SHA and the id of the run, nothing a person wrote. */
export function logReport(logger: Logger, target: ReportTarget, checkRunId: GithubId, event: string): void {
  logger.info(
    {
      githubInstallationId: target.githubInstallationId,
      githubRepoId: target.githubRepoId,
      prNumber: target.prNumber,
      headSha: target.headSha,
      checkRunId,
    },
    event,
  );
}
