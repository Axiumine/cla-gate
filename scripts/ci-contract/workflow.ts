// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { compareNames } from '../code-caps/types.ts';
import { usesProblems } from './uses.ts';

// E20-S09: the contract of the workflow files. Every `uses:` is pinned by full commit SHA with a release comment (so
// Dependabot can move the SHA and the comment together), and no workflow runs on `pull_request_target` (it hands a fork's pull
// request a token with write access). The required jobs are judged in required.ts.

const EXTENSION = /\.ya?ml$/;

const triggerSchema = z.object({
  on: z.union([z.string(), z.array(z.string()), z.record(z.string(), z.unknown())]),
});

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
