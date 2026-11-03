// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { hasNewerHeadRow } from '../../adapters/db/pr-evaluation-links.ts';
import type { Evaluation } from '../../domain/evaluation/index.ts';
import type { DisplayNames } from '../../domain/reporting/display-names.ts';
import { runReport } from '../../domain/reporting/run-report.ts';
import type { ReportTarget } from '../ports/reporter.ts';
import { upsertComment } from './comment-upsert.ts';
import type { CheckRunReporterOptions } from './report-options.ts';
import { linkKeyOf, logReport, rememberRun } from './report-record.ts';
import { locatorOf, readSituation } from './report-situation.ts';
import { writeRun } from './report-write.ts';

// The two reports of the life of an evaluation (E09-S05): it began (`started`), and it has a verdict (`publish`). Both record the id
// of the run on the row of the pull request (E09-S04); `publish` also keeps the comment of the pull request (E09-S07), after the
// Check Run. The ways a run ends otherwise are in run-endings.ts.

/** The two triggers that mean a person asked to see the check run again, and so get a fresh run even when the SHA has a finished one. */
const VISIBLE_RERUNS: ReadonlySet<ReportTarget['trigger']> = new Set(['check_rerequested', 'recheck']);

/**
 * Makes sure the head SHA has a Check Run that is `in_progress`: none on the SHA means a new one, with the id of the row as its
 * external id; one that is not completed is reused untouched; a completed one is left as it is, except for a person's request to
 * run the check again, which gets a fresh run.
 * @throws TenantMismatchError, EvaluationRowMissingError and what the GitHub port and the writer throw.
 */
export async function reportStarted(options: CheckRunReporterOptions, target: ReportTarget): Promise<void> {
  const { db, writer, logger } = options;
  const situation = await readSituation(db, target);
  const locator = locatorOf(target, situation.own);
  const existing = await writer.find(locator);
  const reuse = existing !== null && (existing.status !== 'completed' || !VISIBLE_RERUNS.has(target.trigger));
  const checkRunId = reuse
    ? existing.id
    : await writeRun(options, target, {
        ...locator,
        view: { kind: 'in_progress', headSha: target.headSha },
        externalId: String(target.evaluationId),
        forceNew: true,
      });
  await rememberRun(db, target, situation, checkRunId);
  logReport(logger, target, checkRunId, 'report.started');
}

/**
 * Writes the verdict of `target` to its Check Run, then to the comment of the pull request. The view of the run is this pull
 * request's own, unless another pull request at the same SHA is failing or still being evaluated, which is then what the run says
 * (`failure` over `in_progress` over `success`); the comment always says this pull request's own verdict (E09-S07).
 * @throws TenantMismatchError, EvaluationRowMissingError, InvalidSignLinkError for a base URL that cannot make a sign link, and
 * what the GitHub port and the writer throw.
 */
export async function reportPublished(
  options: CheckRunReporterOptions,
  target: ReportTarget,
  evaluation: Evaluation,
  names: DisplayNames,
): Promise<void> {
  const { db, logger, publicBaseUrl } = options;
  const situation = await readSituation(db, target);
  // Asked before the id of the run is recorded: a write of either id touches `updated_at` of the row, and with it the answer.
  const stale = await hasNewerHeadRow(db, situation.scope, linkKeyOf(target, situation));
  const others = situation.rows.filter((row) => row.prNumber !== target.prNumber).map((row) => row.result);
  const report = runReport(
    {
      headSha: target.headSha,
      evaluation,
      names,
      githubRepoId: target.githubRepoId,
      prNumber: target.prNumber,
      publicBaseUrl,
    },
    others,
  );
  const checkRunId = await writeRun(options, target, {
    ...locatorOf(target, situation.own),
    view: report.view,
    externalId: String(target.evaluationId),
    ...(report.signUrl === null ? {} : { detailsUrl: report.signUrl }),
  });
  await rememberRun(db, target, situation, checkRunId);
  logReport(logger, target, checkRunId, 'report.published');
  await upsertComment(options, target, situation, { content: report.comment, stale });
}
