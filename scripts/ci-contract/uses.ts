// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { isMap, isScalar, isSeq } from 'yaml';

// E20-S09: the pinning rule. Every `uses:` of a job or a step is `owner/repo@<40 hex digit commit SHA>` followed on the same
// line by a `# vX.Y.Z` comment, so Dependabot can move the SHA and the comment together. Local actions (`./...`) are exempt.

const SHA_40 = /^[0-9a-f]{40}$/;
const SEGMENT = /^[\w.-]+$/;
const RELEASE_COMMENT = /^v\d+\.\d+\.\d+$/;
const LOCAL_ACTION = /^\.\.?\//;

interface Use {
  readonly job: string;
  readonly where: string;
  readonly value: string;
  readonly comment: string | null | undefined;
}

/** The `uses:` of a job or of a step (a mapping), with its trailing same-line comment; nothing when there is none. */
function useOf(holder: unknown, job: string, where: string): Use[] {
  if (!isMap(holder) || !holder.has('uses')) {
    return [];
  }
  const node = holder.get('uses', true);
  const scalar = isScalar(node);
  return [{ job, where, value: scalar ? String(node.value) : '', comment: scalar ? node.comment : undefined }];
}

function jobUses(id: string, job: unknown): Use[] {
  const steps = isMap(job) ? job.get('steps', true) : undefined;
  const stepUses = isSeq(steps) ? steps.items.flatMap((step, index) => useOf(step, id, `step ${index + 1}`)) : [];
  return [...useOf(job, id, 'the job'), ...stepUses];
}

/** The pinning problems of every `uses:` under the `jobs` node of a workflow (jobs and steps), in file order. */
export function usesProblems(file: string, jobs: unknown): string[] {
  const uses = isMap(jobs) ? jobs.items.flatMap((pair) => jobUses(String(pair.key), pair.value)) : [];
  return uses.flatMap((use) => pinProblems(file, use));
}

/** `owner/repo@<40 lowercase hex>`, with an optional path inside the repository (`github/codeql-action/init@...`). */
function isPinned(value: string): boolean {
  const parts = value.split('@');
  const segments = String(parts.at(0)).split('/');
  return (
    parts.length === 2 &&
    SHA_40.test(String(parts.at(1))) &&
    segments.length >= 2 &&
    segments.every((segment) => SEGMENT.test(segment) && segment !== '.' && segment !== '..')
  );
}

/** What is wrong with one `uses:` (`file` and the job go into the sentence); empty when it is pinned and commented. */
function pinProblems(file: string, use: Use): string[] {
  const where = `${file}: job "${use.job}" ${use.where}`;
  if (LOCAL_ACTION.test(use.value)) {
    return [];
  }
  if (!isPinned(use.value)) {
    return [`${where}: uses "${use.value}" is not owner/repo@<40 hex digit commit SHA>`];
  }
  const comment = use.comment?.trim();
  return comment !== undefined && RELEASE_COMMENT.test(comment)
    ? []
    : [`${where}: uses "${use.value}" needs a trailing comment with its release, like "# v1.2.3"`];
}
