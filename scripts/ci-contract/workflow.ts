// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { compareNames } from '../code-caps/types.ts';
import { usesProblems } from './uses.ts';

// E20-S09: the contract of the workflow files. Every `uses:` is pinned by full commit SHA with a release comment (so
// Dependabot can move the SHA and the comment together), no workflow runs on `pull_request_target` (it hands a fork's pull
// request a token with write access), and every job that CLAUDE.md names as required exists under its exact name with no
// job-level `if:` (a skipped job reports no check, and a required check that never reports blocks every merge). The one `if:`
// a required job may have is `always()`, and a required job that waits for others (`needs:`) must have it and must read their
// results: a job that needs another is skipped when that one fails or is cancelled, and a skipped required check counts as
// passing, so `coverage`, which merges the reports of the `coverage-shard` jobs, would let a failed shard through.

const EXTENSION = /\.ya?ml$/;

const triggerSchema = z.object({
  on: z.union([z.string(), z.array(z.string()), z.record(z.string(), z.unknown())]),
});
const jobsSchema = z.object({
  jobs: z.record(
    z.string(),
    z.looseObject({
      name: z.string().optional(),
      needs: z.union([z.string(), z.array(z.string())]).optional(),
      steps: z.array(z.unknown()).optional(),
    }),
  ),
});
const EXPRESSION = /^\$\{\{(?<inner>[^}]*)}}$/;

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

/** True for the `if:` that cannot skip a job: `always()`, bare or inside `${{ }}`. */
function runsAlways(condition: unknown): boolean {
  if (typeof condition !== 'string') {
    return false;
  }
  const text = condition.trim();
  return (EXPRESSION.exec(text)?.groups?.['inner'] ?? text).trim() === 'always()';
}

/** What a required job that waits for other jobs gets wrong: it can be skipped, or it never looks at what they ended as. */
function needsProblems(file: string, name: string, id: string, job: z.infer<typeof jobsSchema>['jobs'][string]) {
  const needed = typeof job.needs === 'string' ? [job.needs] : (job.needs ?? []);
  if (needed.length === 0) {
    return [];
  }
  if (!runsAlways(job['if'])) {
    return [
      `${file}: the required job "${name}" (${id}) needs ${needed.join(', ')} without a job-level if: always(), so it is skipped when one of them fails, and a skipped required check counts as passing`,
    ];
  }
  const steps = JSON.stringify(job.steps ?? []);
  return needed
    .filter((each) => !steps.includes(`needs.${each}.result`))
    .map(
      (each) =>
        `${file}: the required job "${name}" (${id}) runs with always() but no step reads needs.${each}.result, so it passes when ${each} fails`,
    );
}

/**
 * What is wrong with the required jobs in a workflow: one missing under its exact name, with a job-level if that can skip it,
 * or one that waits for other jobs without running always() and reading their results.
 */
export function requiredJobProblems(file: string, text: string, required: readonly string[]): string[] {
  const parsed = jobsSchema.safeParse(parseDocument(text).toJS());
  const jobs = parsed.success ? Object.entries(parsed.data.jobs) : [];
  return required.flatMap((name) => {
    const named = jobs.filter(([id, job]) => (job.name ?? id) === name);
    if (named.length === 0) {
      return [`${file}: the required check "${name}" has no job with that exact name`];
    }
    return named.flatMap(([id, job]) =>
      Object.hasOwn(job, 'if') && !runsAlways(job['if'])
        ? [`${file}: the required job "${name}" (${id}) has a job-level if:, so it can be skipped and never report`]
        : needsProblems(file, name, id, job),
    );
  });
}
