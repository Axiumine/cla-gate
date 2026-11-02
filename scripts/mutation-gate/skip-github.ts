// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import { itemsOf, type Listing, type Source, UndecidedError } from './skip-http.ts';

// The two questions of the skip decision of the nightly mutation run (E20-S04), asked of the Actions REST API through the
// read-only layer of skip-http.ts: which completed scheduled runs of ci.yml exist for a commit, and did a job pass in a run.

const WORKFLOW_FILE = 'ci.yml';
/** Runs whose jobs are read before the search gives up. */
export const MAX_RUNS = 10;

/** The ids of the completed runs of ci.yml that the nightly schedule started for exactly this commit, newest first. */
export async function* scheduledRunsOf(source: Source, sha: string): AsyncGenerator<number> {
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

/** Whether the job of that name concluded `success` in the run; a run without such a job did not pass. */
export async function jobPassed(source: Source, runId: number, jobName: string): Promise<boolean> {
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
  return false;
}
