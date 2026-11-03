// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import type { EvaluatePrPorts } from '../evaluate-pr/evaluate-pr-ports.ts';
import type { Resolved } from '../evaluate-pr/evaluation-tenant.ts';

// What the `close-pr` job is given (E07-S06). It needs of an evaluation's ports what it reads and writes: the database, the
// GitHub client (bound to the signal of the job), the clock of the repository snapshot and the reporter, and not the engine.

/** What the job is made of. */
export type ClosePrPorts = Pick<EvaluatePrPorts, 'db' | 'github' | 'clock' | 'reporter'>;

/** The closed pull request: where it is, and the head SHA GitHub shows for it now, when it still shows it. */
export interface Closed {
  readonly githubInstallationId: GithubId;
  readonly githubRepoId: GithubId;
  readonly prNumber: number;
  readonly resolved: Resolved;
  readonly currentHeadSha: string | undefined;
}
