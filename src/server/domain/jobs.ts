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
export const prNumberField = { prNumber: z.int().positive() };

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

/**
 * Why a `sweep-repository` job exists (E07-S09): a change of policy that can turn a pull request's check from green to red or
 * back. The set is closed so that a caller cannot invent a reason; the callers are E12-S04 (`cla_version_published`), E14 and E15.
 */
const SWEEP_REPOSITORY_REASONS = [
  'repository_enabled',
  'cla_version_published',
  'cla_document_changed',
  'allowlist_changed',
  'signature_revoked',
  'signatures_invalidated',
  'override_changed',
] as const;

/** A 40-digit lower-case commit id, the form GitHub writes. */
const headShaField = { headSha: z.string().regex(/^[0-9a-f]{40}$/) };

/**
 * Every job a webhook delivery can start, keyed by `type` (the queue name). One schema per job:
 * `evaluate-pr` evaluates one pull request; `evaluate-head-sha` resolves a head SHA to its open pull requests (a check
 * re-run names none for a fork); `close-pr` prunes the pending work of a closed pull request; `recheck-comment`
 * re-reads a comment that may be a `/recheck`; `sync-installation` re-reads an installation and its repositories;
 * `revoke-user-sessions` ends the sessions of a user who revoked the App's authorisation.
 * The router builds typed {@link Job}s; the envelope of E07-S03 (`job-envelope.ts`) validates the data of a job against it.
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
  // Not started by a webhook: a change of policy sends it (E12-S04 for a new major version). The last member, so that the
  // rebase onto E07-S09, which owns the job, removes one hunk.
  z.strictObject({
    type: z.literal('sweep-repository'),
    ...repositoryFields,
    reason: z.enum(SWEEP_REPOSITORY_REASONS),
  }),
]);

/** One job of the catalogue: its `type` and the ids it carries. */
export type Job = z.infer<typeof jobSchema>;
