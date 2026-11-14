// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { parseDocument } from 'yaml';
import { z } from 'zod';

// E20-S09: the jobs that CLAUDE.md names as required status checks. The contract test fails when one of them is missing from
// the workflow files (ci.yml, codeql.yml), renamed, or made conditional, because GitHub then waits forever for a check that
// never reports. A required job exists under its exact name, in one of the workflow files (ci.yml holds `static`, `coverage`
// and `qodana`, codeql.yml holds `codeql`), with no job-level `if:` (a skipped job reports no check). The one `if:` a required
// job may have is `always()`, and a required job that waits for others (`needs:`) must have it and must read their results: a
// job that needs another is skipped when that one fails or is cancelled, and a skipped required check counts as passing, so
// `coverage`, which merges the reports of the `coverage-shard` jobs, would let a failed shard through. `qodana` waits for
// `coverage` and follows the same rule: it runs always() and its first step fails when `needs.coverage.result` is not success.

/** The list marker, the indentation and the bold opener in front of the bullet's text. */
const LEAD = /^[\s*-]+/;
/**
 * The bullet that lists the required checks: the word "status" is optional and the colon may sit inside the bold span, so a
 * rewrite of the wording keeps working. The captured sentence ends at the first opening parenthesis, which starts the remark
 * about strictness, so a job named in that remark does not count as required.
 */
const REQUIRED_LINE = /^Required (?:status )?checks\*{0,2}:(?<sentence>[^(]*)/;
const CODE_SPAN = /`([^`]+)`/g;

/** The names between backticks in the sentence of the "Required status checks" bullet, in order and without repeats. */
export function requiredJobNames(document: string): string[] {
  const names = document
    .split('\n')
    .flatMap((line) => {
      const sentence = REQUIRED_LINE.exec(line.replace(LEAD, ''))?.groups?.['sentence'];
      return sentence === undefined ? [] : [...sentence.matchAll(CODE_SPAN)];
    })
    .map((match) => String(match[1]));
  return [...new Set(names)];
}

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

/** True for the `if:` that cannot skip a job: `always()`, bare or inside `${{ }}`. */
function runsAlways(condition: unknown): boolean {
  if (typeof condition !== 'string') {
    return false;
  }
  const text = condition.trim();
  return (EXPRESSION.exec(text)?.groups?.['inner'] ?? text).trim() === 'always()';
}

type Job = z.infer<typeof jobsSchema>['jobs'][string];

/** What a required job that waits for other jobs gets wrong: it can be skipped, or it never looks at what they ended as. `who` opens every message. */
function needsProblems(who: string, job: Job) {
  const needed = typeof job.needs === 'string' ? [job.needs] : (job.needs ?? []);
  if (needed.length === 0) {
    return [];
  }
  if (!runsAlways(job['if'])) {
    return [
      `${who} needs ${needed.join(', ')} without a job-level if: always(), so it is skipped when one of them fails, and a skipped required check counts as passing`,
    ];
  }
  const steps = JSON.stringify(job.steps ?? []);
  return needed
    .filter((each) => !steps.includes(`needs.${each}.result`))
    .map((each) => `${who} runs with always() but no step reads needs.${each}.result, so it passes when ${each} fails`);
}

/** The jobs of one workflow file as `[id, job]`, none when the text is not a workflow. */
function jobsOf(text: string): [string, Job][] {
  const parsed = jobsSchema.safeParse(parseDocument(text).toJS());
  return parsed.success ? Object.entries(parsed.data.jobs) : [];
}

/** The name GitHub shows for a job, and so the name of its check: `name:`, or the id. */
function checkName([id, job]: [string, Job]): string {
  return job.name ?? id;
}

/** What is wrong with one job that carries a required name: a job-level if that can skip it, or a need it does not honour. */
function requiredJobIssues(file: string, name: string, [id, job]: [string, Job]) {
  const who = `${file}: the required job "${name}" (${id})`;
  return Object.hasOwn(job, 'if') && !runsAlways(job['if'])
    ? [`${who} has a job-level if:, so it can be skipped and never report`]
    : needsProblems(who, job);
}

/**
 * What is wrong with the required jobs in the given workflow files: one missing under its exact name in every file, with a
 * job-level if that can skip it, or one that waits for other jobs without running always() and reading their results. A check
 * is known by its job name alone, so a required name may be held by a job of any file (`codeql` is in codeql.yml, `static` in
 * ci.yml); the files are judged in the order given, and the problems of one file come before those of the next.
 */
export function requiredChecksProblems(
  workflows: readonly { readonly file: string; readonly text: string }[],
  required: readonly string[],
): string[] {
  const parsed = workflows.map(({ file, text }) => ({ file, jobs: jobsOf(text) }));
  const files = workflows.map(({ file }) => file).join(', ');
  return required.flatMap((name) => {
    const holders = parsed.flatMap(({ file, jobs }) =>
      jobs.filter((job) => checkName(job) === name).map((job) => ({ file, job })),
    );
    return holders.length === 0
      ? [`${files}: the required check "${name}" has no job with that exact name`]
      : holders.flatMap(({ file, job }) => requiredJobIssues(file, name, job));
  });
}

/** What is wrong with the required jobs of one workflow file (`requiredChecksProblems` with a single file). */
export function requiredJobProblems(file: string, text: string, required: readonly string[]): string[] {
  return requiredChecksProblems([{ file, text }], required);
}
