// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { printable } from '../../code-caps/types.ts';
import { isMapping, type Violation, WorkflowError } from './guard-types.ts';
import { checkPermissions } from './permission-rules.ts';
import { checkContainers, checkRunsOn, checkTimeout, checkTriggers } from './runner-rules.ts';

export { type Violation, WorkflowError };

// The rules of docs/ci-runners.md ("Rules for adding a job"). This module judges one parsed workflow; the rules live in
// runner-rules.ts (R1 to R4 and R7) and permission-rules.ts (R5); reading the directory and printing is guard-cli.ts. The guard
// catches accidents and reviewed changes: a hostile pull request can edit it too, which is why the fork approval gate
// exists.

/**
 * The files whose jobs hold a write token (release, scorecard, and the code scanning upload of codeql.yml): they run on
 * GitHub-hosted runners only (R2), and only they may ask for `security-events: write` or `id-token: write` (R5).
 * Case-insensitive and anywhere in the name on purpose: `Release.YML`, `release-please.yml`, `scorecards.yml` and
 * `codeql-analysis.yml` must not dodge the stricter rules. The cost is a false positive for a harmless `release-notes.yml`,
 * which can be renamed.
 */
const HOSTED_ONLY_FILE = /release|scorecard|codeql/i;

function checkJob(file: string, id: string, job: unknown, hostedOnly: boolean): Violation[] {
  if (!isMapping(job)) {
    throw new WorkflowError(`${file}: job ${printable(id)} is not a mapping`);
  }
  if ('uses' in job) {
    return [
      { file, job: id, rule: 'R6', message: 'job-level uses (reusable workflows) is not supported by this guard' },
    ];
  }
  return [
    ...checkRunsOn(file, id, job['runs-on'], hostedOnly),
    ...checkTimeout(file, id, job['timeout-minutes']),
    ...checkContainers(file, id, job),
    ...checkPermissions(file, id, job, hostedOnly),
  ];
}

/** Judges one parsed workflow (`file` is the repository-relative path, only used for the report and for R2 and R5). */
export function checkWorkflow(file: string, workflow: unknown): Violation[] {
  if (!isMapping(workflow) || !('on' in workflow) || !isMapping(workflow['jobs'])) {
    throw new WorkflowError(`${printable(file)}: not a workflow (a mapping with "on" and "jobs" is required)`);
  }
  // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- linear alternation on a file name from our own directory listing, not request data
  const hostedOnly = HOSTED_ONLY_FILE.test(path.basename(file));
  return [
    ...checkTriggers(file, workflow['on']),
    ...checkPermissions(file, null, workflow, hostedOnly),
    ...Object.entries(workflow['jobs']).flatMap(([id, job]) => checkJob(file, id, job, hostedOnly)),
  ];
}

/** `file: job "id": R1 message`, or `file: workflow: R3 message`; file and job are escaped, so a name cannot forge a line. */
export function formatViolation(violation: Violation): string {
  const where = violation.job === null ? 'workflow' : `job "${printable(violation.job)}"`;
  return `${printable(violation.file)}: ${where}: ${violation.rule} ${violation.message}`;
}
