// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import { type Env, variable } from '../ci/lib/env.ts';
import { printable } from '../code-caps/types.ts';
import { SHARD_NAMES } from './shards.ts';
import { newestVerdict } from './skip-github.ts';
import { type Fetcher, type Source, UndecidedError } from './skip-http.ts';

// Skip when nothing changed (E20-S04). The nightly run is the safety net of the mutation gate, always cold (`--force`), and a
// shard is skipped only when the same commit already passed it in an earlier nightly run: the newest completed run of ci.yml
// of the event `schedule` whose head_sha is this run's commit and that has the job `mutation (<shard>)` is the one that
// decides, and the shard skips when that job concluded `success`. A leg that skipped itself ends `success` too, so by
// induction a success on a commit means a cold pass of that shard on it. A budget stop, a timeout, a cancel and a score below
// the threshold are not `success`, and because the newest run decides, an older pass on the same commit does not outrank a
// newer failure: a shard that went red reruns every night until it passes.
//
// Only the schedule event can skip: a manual run and a release-candidate tag were asked for by a person. Everything that goes
// wrong while asking (network, a status other than 200, a rate limit, a shape that is not expected, a missing job, a cap)
// means "do not skip", never a failure: a lost record costs time, not coverage. The only throw is for a shard name that is
// not a shard of shards.ts, which is a bug of the caller and not a property of the lookup.

/** The answer: skip the leg, or run it; the message says which and why, in one line, and holds no secret. */
export type Decision =
  | { readonly skip: true; readonly message: string; readonly runId: number; readonly sha: string }
  | { readonly skip: false; readonly message: string };

/** The time the whole lookup may take; a slower API is a reason not to skip. */
export const LOOKUP_TIMEOUT_MS = 60_000;

// `owner/name`; neither part may be `.` or `..`, which a URL would resolve instead of sending.
const REPOSITORY = /^(?!\.{1,2}\/)[A-Za-z0-9_.-]+\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/;
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const RUN_ID = /^[1-9]\d{0,14}$/;

/** The name GitHub gives the job of a shard: the `name` of the `mutation` job with its matrix value. */
export function jobNameOf(shard: string): string {
  return `mutation (${shard})`;
}

function run(message: string): Decision {
  return { skip: false, message: `run, ${message}` };
}

/** The value of a variable that must match a pattern. */
function matching(env: Env, name: string, pattern: RegExp): string {
  const value = variable(env, name);
  if (!pattern.test(value)) {
    throw new UndecidedError(`${name} is missing or malformed`);
  }
  return value;
}

/** The API root, without a trailing slash; the token is only ever sent over https. */
function apiUrlOf(env: Env): string {
  const text = variable(env, 'GITHUB_API_URL');
  if (!URL.canParse(text) || new URL(text).protocol !== 'https:') {
    throw new UndecidedError('GITHUB_API_URL is missing or not an https URL');
  }
  return text.replace(/\/$/, '');
}

async function lookup(env: Env, fetcher: Fetcher, shard: string): Promise<Decision> {
  const source: Source = {
    fetcher,
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    apiUrl: apiUrlOf(env),
    repository: matching(env, 'GITHUB_REPOSITORY', REPOSITORY),
    token: variable(env, 'GITHUB_TOKEN'),
  };
  const sha = matching(env, 'GITHUB_SHA', COMMIT);
  const verdict = await newestVerdict(source, sha, Number(matching(env, 'GITHUB_RUN_ID', RUN_ID)), jobNameOf(shard));
  if (verdict === undefined) {
    return run(`no earlier scheduled run passed ${jobNameOf(shard)} on commit ${sha}`);
  }
  if (!verdict.passed) {
    return run(`the newest earlier scheduled run, ${verdict.runId}, did not pass ${jobNameOf(shard)} on commit ${sha}`);
  }
  return {
    skip: true,
    runId: verdict.runId,
    sha,
    message: `skip, scheduled run ${verdict.runId} already passed ${jobNameOf(shard)} on commit ${sha}`,
  };
}

/** What may be printed of an error: our own reasons, and for anything else only its class, never a message that might hold a header. */
export function reasonOf(error: unknown): string {
  if (error instanceof UndecidedError) {
    return printable(error.message);
  }
  return error instanceof Error ? `unexpected ${printable(error.name)}` : 'unexpected failure';
}

/**
 * Whether the leg of `STRYKER_SHARD` can be skipped. Throws for a shard that is not one of shards.ts (before any request);
 * every other problem is a decision to run.
 */
export async function decide(env: Env, fetcher: Fetcher): Promise<Decision> {
  const shard = variable(env, 'STRYKER_SHARD');
  if (!SHARD_NAMES.includes(shard)) {
    throw new UndecidedError(`STRYKER_SHARD must be one of ${SHARD_NAMES.join(', ')}, not ${JSON.stringify(shard)}`);
  }
  try {
    const event = variable(env, 'GITHUB_EVENT_NAME');
    if (event !== 'schedule') {
      return run(`the event is ${JSON.stringify(event)}, and only the nightly schedule can skip`);
    }
    return await lookup(env, fetcher, shard);
  } catch (error) {
    return run(`the lookup did not give an answer (${reasonOf(error)})`);
  }
}
