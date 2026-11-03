// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import type { GithubId } from '../../../shared/github-id.ts';
import type { Database } from '../../adapters/db/schema.ts';
import type { GitHubClient } from '../ports/github.ts';
import type { CheckRunWriter } from './check-run-writer.ts';

// What the reporter of the evaluation job (E09-S05, E09-S06) is made of, shared by the files that split its work.

export interface CheckRunReporterOptions {
  readonly db: Kysely<Database>;
  /** The client the pull request comment is written with (E09-S06, E09-S07); the Check Run goes through `writer`, which holds the same client. */
  readonly github: GitHubClient;
  readonly writer: CheckRunWriter;
  /** The numeric id of this App (`GITHUB_APP_ID`): a comment is ours only when GitHub says it was posted through this App (E09-S07). */
  readonly appId: GithubId;
  /** `PUBLIC_BASE_URL`: the origin of this deployment, which the sign link is built on. */
  readonly publicBaseUrl: string;
  readonly logger: Logger;
}
