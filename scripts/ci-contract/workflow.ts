// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { compareNames } from '../code-caps/types.ts';
import { usesProblems } from './uses.ts';

// E20-S09: the contract of the workflow files. Every `uses:` is pinned by full commit SHA with a release comment (so
// Dependabot can move the SHA and the comment together), no workflow runs on `pull_request_target` (it hands a fork's pull
// request a token with write access), and every job that CLAUDE.md names as required exists under its exact name with no
// job-level `if:` (a skipped job reports no check, and a required check that never reports blocks every merge).

const EXTENSION = /\.ya?ml$/;

const triggerSchema = z.object({
  on: z.union([z.string(), z.array(z.string()), z.record(z.string(), z.unknown())]),
});
const jobsSchema = z.object({ jobs: z.record(z.string(), z.looseObject({ name: z.string().optional() })) });

/** The workflow files among a directory listing (`.yml` and `.yaml`, as the runner guard reads them), in code point order. */
export function workflowFileNames(listing: readonly string[]): string[] {
  return listing.filter((name) => EXTENSION.test(name)).sort(compareNames);
}

function eventNames(on: string | string[] | Record<string, unknown>): string[] {
  if (typeof on === 'string') {
    return [on];
  }
  return Array.isArray(on) ? on : Object.keys(on);
}

function runsOnPullRequestTarget(workflow: unknown): boolean {
  const parsed = triggerSchema.safeParse(workflow);
  return parsed.success && eventNames(parsed.data.on).includes('pull_request_target');
}

/** What breaks the pinning and trigger rules in one workflow file, one sentence each; empty when it is clean. */
export function workflowProblems(file: string, text: string): string[] {
  const document = parseDocument(text);
  if (document.errors.length > 0) {
    return document.errors.map((error) => `${file}: does not parse as YAML: ${error.message.split('\n', 1).join('')}`);
  }
  const unpinned = usesProblems(file, document.get('jobs', true));
  const target = runsOnPullRequestTarget(document.toJS())
    ? [`${file}: runs on pull_request_target, which gives a fork's pull request a token with write access`]
    : [];
  return [...unpinned, ...target];
}

/** What is wrong with the required jobs in a workflow: one missing under its exact name, or with a job-level if. */
export function requiredJobProblems(file: string, text: string, required: readonly string[]): string[] {
  const parsed = jobsSchema.safeParse(parseDocument(text).toJS());
  const jobs = parsed.success ? Object.entries(parsed.data.jobs) : [];
  return required.flatMap((name) => {
    const named = jobs.filter(([id, job]) => (job.name ?? id) === name);
    if (named.length === 0) {
      return [`${file}: the required check "${name}" has no job with that exact name`];
    }
    return named
      .filter(([, job]) => Object.hasOwn(job, 'if'))
      .map(
        ([id]) =>
          `${file}: the required job "${name}" (${id}) has a job-level if:, so it can be skipped and never report`,
      );
  });
}
