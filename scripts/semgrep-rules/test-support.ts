// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
//
// Test helpers for E20-S01: a fake `fetch`, and the repository's own configuration files read and parsed once.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parse } from 'yaml';
import { z } from 'zod';
import { exists, readText } from '../ci/lib/test-support.ts';
import { compareNames } from '../code-caps/types.ts';
import type { FetchLike } from './download.ts';

/** The smallest text that is a Semgrep rule file. */
export const RULE_FILE =
  'rules:\n- id: demo.rule\n  message: demo\n  languages: [typescript]\n  severity: ERROR\n  pattern: demo()\n';

/** A `fetch` that answers every URL with `body` and `status`, and records the URLs it was asked for. */
export function answering(body: string, status = 200): { fetchImpl: FetchLike; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl: FetchLike = (url) => {
    urls.push(url);
    return Promise.resolve(new Response(body, { status }));
  };
  return { fetchImpl, urls };
}

/** A `fetch` that answers per rule set: the entry for the last path segment of the URL, or a 404 when there is none. */
export function perRuleset(responses: Readonly<Record<string, Response | Error>>): FetchLike {
  return (url) => {
    const answer = new Map(Object.entries(responses)).get(url.slice(url.lastIndexOf('/') + 1));
    if (answer instanceof Error) {
      return Promise.reject(answer);
    }
    return Promise.resolve(answer ?? new Response('{"error":"not found"}', { status: 404 }));
  };
}

export const ROOT = path.resolve(import.meta.dirname, '../..');

/** The `semgrep` executable on the PATH of this process, or undefined where it is not installed. */
export const SEMGREP_BINARY = String(process.env['PATH'])
  .split(path.delimiter)
  .map((directory) => path.join(directory, 'semgrep'))
  .find(exists);

/** The names in a directory, in code point order. */
export function listDir(directory: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: a path inside a temp directory
  return fs.readdirSync(directory).sort(compareNames);
}

/** A file of the repository, by repository-relative path. */
export function repoText(file: string): string {
  return readText(path.join(ROOT, file));
}

/** `workflow` without its `qodana` job: the text from the job's key to the next job's key, or to the end of the file. */
export function withoutQodanaJob(workflow: string): string {
  return workflow.replace(/\n {2}qodana:\n[\s\S]*?(?=\n {2}[\w-]+:\n|$)/, '');
}

/**
 * The text of ci.yml without the `qodana` job (E20-S08). That job is the one job that may use a secret: it runs on a
 * GitHub-hosted machine. What is left runs on the shared self-hosted runners, where no secret may appear.
 */
export function ciTextOnSharedRunners(): string {
  return withoutQodanaJob(repoText('.github/workflows/ci.yml'));
}

/** The lines of a configuration file that are not comments or blank. */
export function activeLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

function repoYaml(file: string): unknown {
  const parsed: unknown = parse(repoText(file));
  return parsed;
}

/** The `scripts` of package.json. */
export const SCRIPTS = new Map(
  Object.entries(
    z.object({ scripts: z.record(z.string(), z.string()) }).parse(JSON.parse(repoText('package.json'))).scripts,
  ),
);

const stepSchema = z.object({
  name: z.string(),
  id: z.string().optional(),
  uses: z.string().optional(),
  run: z.string().optional(),
  if: z.string().optional(),
  'continue-on-error': z.unknown().optional(),
  with: z.record(z.string(), z.unknown()).optional(),
  env: z.record(z.string(), z.unknown()).optional(),
});
const jobSchema = z.object({
  name: z.string(),
  needs: z.unknown().optional(),
  if: z.unknown().optional(),
  // The shared self-hosted list, or the one literal ubuntu-24.04 of the qodana job (E20-S08).
  'runs-on': z.union([z.string(), z.array(z.string())]),
  'timeout-minutes': z.number(),
  permissions: z.unknown().optional(),
  env: z.unknown().optional(),
  steps: z.array(stepSchema),
});
const workflowSchema = z.object({ jobs: z.record(z.string(), jobSchema) });

/** Every file directly inside .github/workflows, parsed. */
export function workflows() {
  const names = fs.readdirSync(path.join(ROOT, '.github/workflows'));
  return names.map((name) => ({ name, ...workflowSchema.parse(repoYaml(`.github/workflows/${name}`)) }));
}

/** The job `id` of ci.yml (a zod error when there is none). */
export function ciJob(id: string) {
  const jobs = new Map(Object.entries(workflowSchema.parse(repoYaml('.github/workflows/ci.yml')).jobs));
  return jobSchema.parse(jobs.get(id));
}
