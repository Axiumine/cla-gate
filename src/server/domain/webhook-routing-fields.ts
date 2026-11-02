// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { githubIdSchema } from '../../shared/github-id.ts';

// The fields each row reads. Every schema is built from the ones the event schemas of E06-S03 declare, so a payload that
// passed them passes these; they strip every other key, which is how nothing else can reach a job.

const idOnly = z.object({ id: githubIdSchema });
const tenant = { repository: idOnly, installation: idOnly };
const prNumber = z.int().positive();
const headSha = z.string().regex(/^[0-9a-f]{40}$/);

export const pullRequestFields = z.object({ pull_request: z.object({ number: prNumber }), ...tenant });
export const checkRunFields = z.object({
  check_run: z.object({ name: z.string(), head_sha: headSha, app: idOnly }),
  ...tenant,
});
export const checkSuiteFields = z.object({ check_suite: z.object({ head_sha: headSha, app: idOnly }), ...tenant });
export const issueCommentFields = z.object({
  issue: z.object({ number: prNumber, pull_request: z.object({}).optional() }),
  comment: z.object({ id: githubIdSchema, body: z.string() }),
  sender: z.object({ type: z.string() }),
  ...tenant,
});
export const installationFields = z.object({ installation: idOnly });
export const appAuthorizationFields = z.object({ sender: idOnly });
