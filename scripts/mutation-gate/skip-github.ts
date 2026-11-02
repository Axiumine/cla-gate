// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import { itemsOf, type Listing, type Source, UndecidedError } from './skip-http.ts';

// The two questions of the skip decision of the nightly mutation run (E20-S04), asked of the Actions REST API through the
// read-only layer of skip-http.ts: which completed scheduled runs of ci.yml exist for a commit, and how a job ended in a run.

const WORKFLOW_FILE = 'ci.yml';
/** Runs without the job that are read before the search gives up (a run that has the job ends the search). */
export const MAX_RUNS = 10;

/** The ids of the completed runs of ci.yml that the nightly schedule started for exactly this commit, newest first. */
async function* scheduledRunsOf(source: Source, sha: string): AsyncGenerator<number> {
  const listing: Listing = {
    path: `/repos/${source.repository}/actions/workflows/${WORKFLOW_FILE}/runs`,
    query: { head_sha: sha, event: 'schedule', status: 'completed' },
    key: 'workflow_runs',
    what: 'the list of runs',
  };
  for await (const run of itemsOf(source, listing)) {
    const id = run['id'];
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || typeof run['head_sha'] !== 'string') {
      throw new UndecidedError(`${listing.what}: an entry has an unexpected shape`);
    }
    // The query filters already; checking again means a filter the API ignored cannot make another commit count.
    if (run['head_sha'] === sha && run['event'] === 'schedule' && run['status'] === 'completed') {
      yield id;
    }
  }
}

/**
 * How the job of that name ended in the run: `true` when it completed with `success`, `false` for anything else (a failure, a
 * cancel, a timeout, a skip, a job that is not completed), and undefined when the run has no job of that name, which says
 * nothing about the shard.
 */
async function jobVerdict(source: Source, runId: number, jobName: string): Promise<boolean | undefined> {
  const listing: Listing = {
    path: `/repos/${source.repository}/actions/runs/${runId}/jobs`,
    query: {},
    key: 'jobs',
    what: `the jobs of run ${runId}`,
  };
  for await (const job of itemsOf(source, listing)) {
    if (typeof job['name'] !== 'string') {
      throw new UndecidedError(`${listing.what}: an entry has an unexpected shape`);
    }
    if (job['name'] === jobName) {
      return job['status'] === 'completed' && job['conclusion'] === 'success';
    }
  }
  return undefined;
}

/** How the newest earlier scheduled run of a commit that has a job ended that job. */
export interface Verdict {
  readonly runId: number;
  readonly passed: boolean;
}

/**
 * The verdict of the newest earlier scheduled run of the commit that has the job (the API lists runs newest first), or
 * undefined when none has it; the run that is asking (`currentRun`) never counts. A run without the job says nothing and the
 * search goes on to the next older run, up to MAX_RUNS of them.
 */
export async function newestVerdict(
  source: Source,
  sha: string,
  currentRun: number,
  jobName: string,
): Promise<Verdict | undefined> {
  let read = 0;
  for await (const runId of scheduledRunsOf(source, sha)) {
    if (runId === currentRun) {
      continue;
    }
    if (read === MAX_RUNS) {
      throw new UndecidedError(`${MAX_RUNS} earlier runs were read without finding the job, so the search stopped`);
    }
    read += 1;
    const passed = await jobVerdict(source, runId, jobName);
    if (passed !== undefined) {
      return { runId, passed };
    }
  }
  return undefined;
}
