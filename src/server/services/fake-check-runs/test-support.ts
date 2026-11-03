// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type GithubId, parseGithubId } from '../../../shared/github-id.ts';
import type { CheckRunWrite, GitHubCheckRun } from '../ports/github.ts';

// The Check Runs of a GitHub in memory (E09-S05), shared by `FakeGitHub` and by the mocked GitHub of the Octokit adapter's tests, so
// that both answer one set of rules: a run belongs to the repository and installation it was posted under, a `PATCH` changes what
// the write names, a completed run needs a conclusion, and a listing keeps the latest run of each App.

/** The repository a call is about: the installation that reached it and `owner/name` as the caller spelled it. */
export interface RepositoryRef {
  readonly installationId: GithubId;
  readonly fullName: string;
}

/** A run with where it lives and the last write it was given (null for a run a test seeded). */
export interface StoredCheckRun {
  readonly run: GitHubCheckRun;
  readonly installationId: GithubId;
  readonly fullName: string;
  readonly write: CheckRunWrite | null;
}

/** A write the world accepted: a `POST` (`create`) or a `PATCH` (`update`), with the id of the run it reached and what it sent (E09-S08). */
export interface CheckRunWriteRecord {
  readonly kind: 'create' | 'update';
  readonly id: GithubId;
  readonly write: CheckRunWrite;
}

/** GitHub compares repository names without regard to case. */
const sameRepository = (stored: StoredCheckRun, repository: RepositoryRef): boolean =>
  stored.installationId === repository.installationId &&
  stored.fullName.toLowerCase() === repository.fullName.toLowerCase();

/** GitHub refuses a run that is `completed` without a conclusion (422). */
export const lacksConclusion = (write: CheckRunWrite): boolean =>
  write.status === 'completed' && write.conclusion === undefined;

export class CheckRunStore {
  /** Every run, in the order they were posted or seeded. */
  readonly runs: StoredCheckRun[] = [];
  /** Every write accepted, oldest first: what a run was sent, which `runs` forgets once the next write replaces it (E09-S08). */
  readonly writes: CheckRunWriteRecord[] = [];
  #next = 9_000_001;

  /** Adds a run that somebody else posted (or one of ours, with the id a test chooses). */
  seed(repository: RepositoryRef, run: GitHubCheckRun): void {
    this.runs.push({ ...repository, run, write: null });
  }

  /** A new run of the App `appId` on `headSha`, named `CHECK_RUN_NAME`, as the `write` says. */
  create(repository: RepositoryRef, appId: GithubId, headSha: string, write: CheckRunWrite): GitHubCheckRun {
    const run: GitHubCheckRun = {
      id: parseGithubId(this.#next),
      headSha,
      status: write.status,
      appId,
      externalId: write.externalId ?? null,
    };
    this.#next += 1;
    this.runs.push({ ...repository, run, write });
    this.writes.push({ kind: 'create', id: run.id, write });
    return run;
  }

  /** The run `id` of the repository, or undefined. */
  find(repository: RepositoryRef, id: GithubId): GitHubCheckRun | undefined {
    return this.runs.find((stored) => sameRepository(stored, repository) && stored.run.id === id)?.run;
  }

  /** Applies `write` to the run `id`: its status, and the external id when the write names one. Undefined for a run that is not there. */
  update(repository: RepositoryRef, id: GithubId, write: CheckRunWrite): GitHubCheckRun | undefined {
    const stored = this.runs.find((each) => sameRepository(each, repository) && each.run.id === id);
    if (stored === undefined) {
      return undefined;
    }
    const run: GitHubCheckRun = {
      ...stored.run,
      status: write.status,
      externalId: write.externalId ?? stored.run.externalId,
    };
    this.runs.splice(this.runs.indexOf(stored), 1, { ...stored, run, write });
    this.writes.push({ kind: 'update', id, write });
    return run;
  }

  /** The runs on `headSha`, the latest (highest id) of each App, newest first: `check_name` and `filter=latest`. Every run here is named `CHECK_RUN_NAME`. */
  latest(repository: RepositoryRef, headSha: string): GitHubCheckRun[] {
    const here = this.runs
      .filter((stored) => sameRepository(stored, repository))
      .map((stored) => stored.run)
      .filter((run) => run.headSha === headSha)
      .toSorted((a, b) => b.id - a.id);
    return here.filter((run, index) => here.findIndex((other) => other.appId === run.appId) === index);
  }
}
