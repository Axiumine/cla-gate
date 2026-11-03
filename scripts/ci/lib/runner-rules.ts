// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { printable } from '../../code-caps/types.ts';
import { describe, isList, isMapping, type Mapping, type Violation } from './guard-types.ts';

const HOSTED_RUNNER = 'ubuntu-24.04';
const SELF_HOSTED_RUNNER: readonly string[] = ['self-hosted', 'Linux', 'X64'];
const SELF_HOSTED_JSON = JSON.stringify(SELF_HOSTED_RUNNER);
const FORBIDDEN_TRIGGERS: ReadonlySet<string> = new Set(['pull_request_target', 'workflow_run']);
/** A job on a shared persistent host may run for an hour at most; the runner's own limit is days. */
const MAX_TIMEOUT_MINUTES = 60;
const CONTAINER_KEYS = ['container', 'services'] as const;
/**
 * The one exception, named by file and job so that no other job (and no job of the same name in another file) gets it: the
 * `mutation` job of ci.yml (E20-S04). Each of its shards repeats Stryker's initial run of the whole server suite, serially in
 * one process, which took 12 min 37 s on the development machine for 7003 tests on 2026-11-03 and is planned for a suite of
 * 25 000 on a runner three times slower (120 minutes), before the mutants (50 minutes more) and the job's other steps. The
 * numbers are derived in stryker.config.mjs and kept in line by scripts/mutation-gate/ci-job.test.ts.
 */
const LONG_JOB = { file: '.github/workflows/ci.yml', job: 'mutation', maxMinutes: 180 } as const;

/** The most `timeout-minutes` this job of this file may have. */
function timeoutCap(file: string, job: string): number {
  return file === LONG_JOB.file && job === LONG_JOB.job ? LONG_JOB.maxMinutes : MAX_TIMEOUT_MINUTES;
}

function exactRunner(value: unknown): boolean {
  return value === HOSTED_RUNNER || (isList(value) && JSON.stringify(value) === SELF_HOSTED_JSON);
}

function triggerNames(on: unknown): string[] {
  if (typeof on === 'string') {
    return [on];
  }
  if (isList(on)) {
    return on.filter((item): item is string => typeof item === 'string');
  }
  return isMapping(on) ? Object.keys(on) : [];
}

export function checkTriggers(file: string, on: unknown): Violation[] {
  return triggerNames(on)
    .filter((name) => FORBIDDEN_TRIGGERS.has(name.toLowerCase()))
    .map((name) => ({ file, job: null, rule: 'R3', message: `trigger ${printable(name)} is forbidden` }));
}

export function checkRunsOn(file: string, job: string, runsOn: unknown, hostedOnly: boolean): Violation[] {
  if (hostedOnly) {
    const message = `runs-on must be the literal ${HOSTED_RUNNER} in this file, found ${describe(runsOn)}`;
    return runsOn === HOSTED_RUNNER ? [] : [{ file, job, rule: 'R2', message }];
  }
  const message = `runs-on must be the literal ${HOSTED_RUNNER} or the literal list [${SELF_HOSTED_RUNNER.join(', ')}], found ${describe(runsOn)}`;
  return exactRunner(runsOn) ? [] : [{ file, job, rule: 'R1', message }];
}

export function checkTimeout(file: string, job: string, minutes: unknown): Violation[] {
  const cap = timeoutCap(file, job);
  const valid = typeof minutes === 'number' && minutes > 0 && minutes <= cap;
  const message = `timeout-minutes must be a positive number of at most ${cap}, found ${describe(minutes)}`;
  return valid ? [] : [{ file, job, rule: 'R4', message }];
}

/**
 * A `container:` or `services:` block defeats every other rule (`--privileged`, a bind mount of `/`, a published
 * `5432:5432`), and this guard cannot judge its options, so it is rejected until the guard is extended. Containers start
 * from a run step through the scripts/ci helpers instead.
 */
export function checkContainers(file: string, job: string, holder: Mapping): Violation[] {
  return CONTAINER_KEYS.filter((key) => key in holder).map((key) => ({
    file,
    job,
    rule: 'R7',
    message: `job-level ${key} is not supported by this guard: start containers through scripts/ci/ (random loopback port, docs/ci-runners.md)`,
  }));
}
