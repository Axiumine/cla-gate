// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import type { Database } from '../../adapters/db/schema.ts';
import type { Evaluation } from '../../domain/evaluation/index.ts';
import type { DisplayNames } from '../../domain/reporting/display-names.ts';
import { runReport } from '../../domain/reporting/run-report.ts';
import type { EvaluationReporter, ReportTarget } from '../ports/reporter.ts';
import type { CheckRunWriter } from './check-run-writer.ts';
import { logReport, rememberRun } from './report-record.ts';
import { locatorOf, readSituation } from './report-situation.ts';

// The reporter of the evaluation job (E09-S05): `started` makes sure the head SHA has a Check Run that is `in_progress`, and
// `publish` writes the verdict to it. The run belongs to the head SHA, not to the pull request: the SHA written is always
// `target.headSha`, never one read elsewhere (the job re-checks the head before it publishes, and a newer job overwriting an
// older one is accepted, E07-S04), and the reporter never asks GitHub for the pull request. Two pull requests can share a head
// SHA; the same pull request is serialised by the queue (E07-S02), so the reporter takes no lock. The id of the run is kept on
// the row of the pull request (E09-S04); `failed` and `cancelled` are E09-S06, and with them the binding at boot.

/** The two triggers that mean a person asked to see the check run again, and so get a fresh run even when the SHA has a finished one. */
const VISIBLE_RERUNS: ReadonlySet<ReportTarget['trigger']> = new Set(['check_rerequested', 'recheck']);

export interface CheckRunReporterOptions {
  readonly db: Kysely<Database>;
  readonly writer: CheckRunWriter;
  /** `PUBLIC_BASE_URL`: the origin of this deployment, which the sign link is built on. */
  readonly publicBaseUrl: string;
  readonly logger: Logger;
}

/** The part of the reporter that the lifecycle of the evaluation job calls (E09-S05). */
type LifecycleReporter = Pick<EvaluationReporter, 'started' | 'publish'>;

export class CheckRunReporter implements LifecycleReporter {
  readonly #options: CheckRunReporterOptions;

  constructor(options: CheckRunReporterOptions) {
    this.#options = options;
  }

  /**
   * The evaluation of `target` began: no run on the SHA means a new `in_progress` run, with the id of the row as its external id;
   * a run that is not completed is reused untouched (a job retried after a crash between the create and the database write makes
   * no second run); a completed run is left as it is, so the previous verdict stays visible until the final write, except for a
   * person's request to run it again (`check_rerequested`, `recheck`), which gets a fresh `in_progress` run.
   * @throws TenantMismatchError for an installation or repository the database does not hold together, EvaluationRowMissingError
   * when the row of the pull request at the SHA does not exist, and what the GitHub port throws.
   */
  async started(target: ReportTarget): Promise<void> {
    const situation = await readSituation(this.#options.db, target);
    const locator = locatorOf(target, situation.own);
    const existing = await this.#options.writer.find(locator);
    const reuse = existing !== null && (existing.status !== 'completed' || !VISIBLE_RERUNS.has(target.trigger));
    const checkRunId = reuse
      ? existing.id
      : (
          await this.#options.writer.upsert({
            ...locator,
            view: { kind: 'in_progress', headSha: target.headSha },
            externalId: String(target.evaluationId),
            forceNew: true,
          })
        ).checkRunId;
    await rememberRun(this.#options.db, target, situation, checkRunId);
    logReport(this.#options.logger, target, checkRunId, 'report.started');
  }

  /**
   * The verdict on `target`, which the job has stored. The run is the one the row records (a missing or vanished one is
   * created already completed, see the writer). Its view is this pull request's own, unless another pull request at the same SHA
   * is failing or still being evaluated, which is then what the run says (`failure` over `in_progress` over `success`).
   * @throws TenantMismatchError, EvaluationRowMissingError, InvalidSignLinkError for a base URL that cannot make a sign link,
   * and what the GitHub port throws.
   */
  async publish(target: ReportTarget, evaluation: Evaluation, names: DisplayNames): Promise<void> {
    const situation = await readSituation(this.#options.db, target);
    const others = situation.rows.filter((row) => row.prNumber !== target.prNumber).map((row) => row.result);
    const report = runReport(
      {
        headSha: target.headSha,
        evaluation,
        names,
        githubRepoId: target.githubRepoId,
        prNumber: target.prNumber,
        publicBaseUrl: this.#options.publicBaseUrl,
      },
      others,
    );
    const { checkRunId } = await this.#options.writer.upsert({
      ...locatorOf(target, situation.own),
      view: report.view,
      externalId: String(target.evaluationId),
      ...(report.signUrl === null ? {} : { detailsUrl: report.signUrl }),
    });
    await rememberRun(this.#options.db, target, situation, checkRunId);
    logReport(this.#options.logger, target, checkRunId, 'report.published');
  }
}
