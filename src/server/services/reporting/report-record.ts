// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import type { GithubId } from '../../../shared/github-id.ts';
import { type LinkKey, recordCheckRunId } from '../../adapters/db/pr-evaluation-links.ts';
import type { Database } from '../../adapters/db/schema.ts';
import type { ReportTarget, RunTarget } from '../ports/reporter.ts';
import type { Situation } from './report-situation.ts';

// What the reporter of the evaluation job (E09-S05) leaves behind after a report: the id of the run on the row of the pull
// request (E09-S04), and one log line made of numeric ids only.

/** The key of the row of the pull request of `target` at its head SHA. */
export function linkKeyOf(target: RunTarget, situation: Situation): LinkKey {
  return { repositoryId: situation.repositoryId, prNumber: target.prNumber, headSha: target.headSha };
}

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
  await recordCheckRunId(db, situation.scope, linkKeyOf(target, situation), checkRunId);
}

/** What a log line of the reporter names of a run: the ids and the head SHA; a merge group (E22-S01) has no pull request number. */
export type LoggedRun = Pick<RunTarget, 'githubInstallationId' | 'githubRepoId' | 'headSha'> & {
  readonly prNumber?: number;
};

/** What every line of the reporter's log names: the numeric ids and the head SHA, nothing a person wrote. */
export function reportIds(target: LoggedRun) {
  return {
    githubInstallationId: target.githubInstallationId,
    githubRepoId: target.githubRepoId,
    ...(target.prNumber === undefined ? {} : { prNumber: target.prNumber }),
    headSha: target.headSha,
  };
}

/** One line per report: the numeric ids, the head SHA and the id of the run, nothing a person wrote. */
export function logReport(logger: Logger, target: LoggedRun, checkRunId: GithubId, event: string): void {
  logger.info({ ...reportIds(target), checkRunId }, event);
}
