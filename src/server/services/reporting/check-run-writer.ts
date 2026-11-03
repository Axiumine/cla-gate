// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import type { GithubId } from '../../../shared/github-id.ts';
import { renderCheckOutput } from '../../domain/reporting/check-output.ts';
import { minimalCheckOutput } from '../../domain/reporting/check-output-minimal.ts';
import type { CheckView } from '../../domain/reporting/check-view.ts';
import type { Clock } from '../ports/clock.ts';
import type { CheckRunWrite, GitHubCheckRun, GitHubClient } from '../ports/github.ts';
import { GitHubNotFoundError, GitHubUnprocessableError } from '../ports/github-errors.ts';

// The low-level writer of the Check Run of a head SHA (E09-S05). It knows a repository, a commit and a view, and nothing of
// pull requests or of `pr_evaluations`, so a merge group (E22) can call it with the SHA of a group. It finds the run of this App for
// the SHA, updates it, or creates one when there is none, when it is asked for a new one, or when GitHub refuses the update
// because the run is gone (404) or cannot be changed (422). Logs carry the installation id, the head SHA, the run id and a status
// code, never a name, a token or a body.

export interface CheckRunWriterOptions {
  readonly github: GitHubClient;
  /** The numeric id of this App (`GITHUB_APP_ID`): a run of another App with the same name is never touched. */
  readonly appId: GithubId;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** Where the Check Run of a head SHA is, and the run the caller already knows of (the id it recorded), if any. */
export interface RunLocator {
  readonly githubInstallationId: GithubId;
  readonly owner: string;
  readonly repo: string;
  readonly headSha: string;
  /** Looked up by its id; a run that is not there (or not this App's, or not on this SHA) means no run, with no listing. */
  readonly existingId?: GithubId;
}

/** What {@link CheckRunWriter.upsert} writes. */
export interface UpsertRequest extends RunLocator {
  readonly view: CheckView;
  /** The `external_id` of the run: the id of the `pr_evaluations` row, as text. */
  readonly externalId?: string;
  /** The `details_url` of the run: the sign link, when the view has one. */
  readonly detailsUrl?: string;
  /** Skip the lookup and create a new run: a person asked for a visible re-run, or the caller has just looked. */
  readonly forceNew?: boolean;
  /** The run the caller has just found with {@link CheckRunWriter.find}: it is updated without a second lookup. Ignored with `forceNew`. */
  readonly known?: GitHubCheckRun;
  /** Write the minimal output of the view (E09-S06: the retry after GitHub answered 422): the counts and the hint, no names, no text. */
  readonly minimal?: boolean;
}

export class CheckRunWriter {
  readonly #options: CheckRunWriterOptions;

  constructor(options: CheckRunWriterOptions) {
    this.#options = options;
  }

  /**
   * The newest run of this App on the head SHA, or null. With `existingId` the run is read by its id (`GET`), and a 404 means there
   * is none; otherwise the listing of the commit is read (GitHub's `filter=latest` leaves the latest run of each App) and the first
   * run whose App is this one is taken. A run of another App with the same name never counts.
   * @throws what the GitHub port throws, rethrown unchanged.
   */
  async find(locator: RunLocator): Promise<GitHubCheckRun | null> {
    const { github } = this.#options;
    const { githubInstallationId, headSha, existingId } = locator;
    const fullName = `${locator.owner}/${locator.repo}`;
    if (existingId !== undefined) {
      const run = await github.getCheckRun(githubInstallationId, fullName, existingId);
      return run !== null && this.#isOurs(run, headSha) ? run : null;
    }
    const runs = await github.listCheckRunsForRef(githubInstallationId, fullName, headSha);
    return runs.find((run) => this.#isOurs(run, headSha)) ?? null;
  }

  /**
   * Writes `request.view` to the Check Run of the head SHA: `PATCH` the run {@link CheckRunWriter.find} finds, or `POST` a new one
   * when there is none, when `forceNew` is set, or when the `PATCH` is answered 404 or 422.
   * @returns the id of the run that now holds the view.
   * @throws what the GitHub port throws for any other failure, rethrown unchanged.
   */
  async upsert(request: UpsertRequest): Promise<{ readonly checkRunId: GithubId }> {
    const write = this.#writeOf(request);
    const existing = request.forceNew === true ? null : (request.known ?? (await this.find(request)));
    if (existing !== null) {
      const updated = await this.#update(request, existing.id, write);
      if (updated !== null) {
        return { checkRunId: updated.id };
      }
    }
    const { github, logger } = this.#options;
    const created = await github.createCheckRun(
      request.githubInstallationId,
      `${request.owner}/${request.repo}`,
      request.headSha,
      write,
    );
    logger.info(
      { githubInstallationId: request.githubInstallationId, headSha: request.headSha, checkRunId: created.id },
      'report.check_run_created',
    );
    return { checkRunId: created.id };
  }

  /** The run of this App on `headSha`: GitHub lists the runs of every App with the name, and a recorded id could be anyone's. */
  #isOurs(run: GitHubCheckRun, headSha: string): boolean {
    return run.appId === this.#options.appId && run.headSha === headSha;
  }

  /** The status, conclusion and output of the view, with the time it began or ended and the references of the request. */
  #writeOf(request: UpsertRequest): CheckRunWrite {
    const output = request.minimal === true ? minimalCheckOutput(request.view) : renderCheckOutput(request.view);
    const now = this.#options.clock.now();
    return {
      ...output,
      ...(output.status === 'completed' ? { completedAt: now } : { startedAt: now }),
      ...(request.externalId === undefined ? {} : { externalId: request.externalId }),
      ...(request.detailsUrl === undefined ? {} : { detailsUrl: request.detailsUrl }),
    };
  }

  /** `PATCH` of the run `checkRunId`, or null when GitHub answers 404 or 422: the run is gone or cannot be changed, and the caller creates one. */
  async #update(request: UpsertRequest, checkRunId: GithubId, write: CheckRunWrite): Promise<GitHubCheckRun | null> {
    const { github, logger } = this.#options;
    const { githubInstallationId, headSha } = request;
    try {
      const run = await github.updateCheckRun(
        githubInstallationId,
        `${request.owner}/${request.repo}`,
        checkRunId,
        write,
      );
      logger.info({ githubInstallationId, headSha, checkRunId, status: write.status }, 'report.check_run_updated');
      return run;
    } catch (error) {
      if (error instanceof GitHubNotFoundError || error instanceof GitHubUnprocessableError) {
        logger.info(
          { githubInstallationId, headSha, checkRunId, statusCode: error instanceof GitHubNotFoundError ? 404 : 422 },
          'report.check_run_recreated',
        );
        return null;
      }
      throw error;
    }
  }
}
