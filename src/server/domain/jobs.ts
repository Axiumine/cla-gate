// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { githubIdSchema } from '../../shared/github-id.ts';

// The catalogue of jobs (E06-S04): the names and the payloads of everything a webhook delivery can start. A payload
// holds numeric ids and the delivery id and nothing else: no login, no email, no comment text, no title. The job
// re-reads what it needs from GitHub with those ids, so a job is small, carries no personal data and cannot be made to
// act on text an attacker chose. Every object is strict: an unknown key makes the job invalid instead of being carried
// along. The queue runtime and the handlers are E07; it validates the data of a job against these schemas (E07-S03).

/**
 * The delivery a job came from (`X-GitHub-Delivery`, a UUID). It is optional because the jobs E07 and later epics start
 * themselves (a sweep, a signature) have no delivery; a job a webhook starts always has one.
 */
const deliveryIdField = { deliveryId: z.guid().optional() };

/** The installation a job belongs to: every query a handler makes filters by it. */
const installationField = { githubInstallationId: githubIdSchema, ...deliveryIdField };

/** The repository of a job, with its installation. */
const repositoryFields = { githubRepoId: githubIdSchema, ...installationField };

/** A pull request number: a positive safe integer, not a GitHub id (it is unique per repository only). */
const prNumberField = { prNumber: z.int().positive() };

/**
 * Why an `evaluate-pr` job exists. A webhook only ever starts `pull_request`; the other values are the callers E07 and
 * later epics add (a `/recheck` comment, a Re-run, a signature, the sweep, a policy change), listed here so the job has
 * one schema whoever enqueues it.
 */
const EVALUATE_TRIGGERS = [
  'pull_request',
  'recheck',
  'check_rerequested',
  'signature',
  'sweep',
  'policy_change',
] as const;

/** A 40-digit lower-case commit id, the form GitHub writes. */
const headShaField = { headSha: z.string().regex(/^[0-9a-f]{40}$/) };

/**
 * Every job a webhook delivery can start, keyed by `type` (the queue name). One schema per job:
 * `evaluate-pr` evaluates one pull request; `evaluate-head-sha` resolves a head SHA to its open pull requests (a check
 * re-run names none for a fork); `close-pr` prunes the pending work of a closed pull request; `recheck-comment`
 * re-reads a comment that may be a `/recheck`; `sync-installation` re-reads an installation and its repositories;
 * `revoke-user-sessions` ends the sessions of a user who revoked the App's authorisation.
 * @internal Exported for the tests and for E07-S03, which validates the data of a job against it (Knip ignores `@internal` exports in production mode); the router builds typed {@link Job}s.
 */
export const jobSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('evaluate-pr'),
    ...repositoryFields,
    ...prNumberField,
    trigger: z.enum(EVALUATE_TRIGGERS),
  }),
  z.strictObject({ type: z.literal('evaluate-head-sha'), ...repositoryFields, ...headShaField }),
  z.strictObject({ type: z.literal('close-pr'), ...repositoryFields, ...prNumberField }),
  z.strictObject({
    type: z.literal('recheck-comment'),
    ...repositoryFields,
    ...prNumberField,
    commentId: githubIdSchema,
  }),
  z.strictObject({ type: z.literal('sync-installation'), ...installationField }),
  z.strictObject({ type: z.literal('revoke-user-sessions'), githubUserId: githubIdSchema, ...deliveryIdField }),
]);

/** One job of the catalogue: its `type` and the ids it carries. */
export type Job = z.infer<typeof jobSchema>;
