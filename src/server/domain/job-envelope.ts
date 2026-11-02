// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { githubIdSchema } from '../../shared/github-id.ts';
import { jobSchema } from './jobs.ts';

// The envelope of every job on the queue (E07-S03): what a worker validates before a handler sees the data. It is the
// catalogue of the jobs a webhook can start (`jobs.ts`, E06-S04) plus the two jobs the scheduler starts, `sweep` and
// `sweep-installation` (E07-S08), which have no delivery. Every schema is strict and holds numeric ids only (a delivery
// id is a UUID), so the data of a job never carries a login, an email or a text somebody chose. A later epic that adds a
// job adds its schema here, in the change that adds its queue (`QUEUE_DEFINITIONS`).

/**
 * Every job a worker can receive, keyed by `type` (the queue name). The jobs of `jobSchema` come first, unchanged; the
 * two that follow are started by the scheduler: `sweep` reconciles the installations and fans out one
 * `sweep-installation` per admitted installation, which re-evaluates the pull requests of one installation that missed a
 * delivery.
 */
export const jobEnvelopeSchema = z.discriminatedUnion('type', [
  ...jobSchema.options,
  z.strictObject({ type: z.literal('sweep') }),
  z.strictObject({ type: z.literal('sweep-installation'), githubInstallationId: githubIdSchema }),
]);

/** The data of one job, as a handler receives it once it is validated. */
export type JobEnvelope = z.infer<typeof jobEnvelopeSchema>;

/** The `type` of a job, which is also the name of its queue. */
export type JobType = JobEnvelope['type'];

/** Every job type with its envelope: one mapped type, so a registry keyed by the type can hand each handler its own envelope. */
type EnvelopeByType = { readonly [E in JobEnvelope as E['type']]: E };

/** The envelope of the job type `T`. */
export type EnvelopeOf<T extends JobType> = EnvelopeByType[T];

/** The type of every job of the envelope, in the order of the schema. */
export const JOB_TYPES: readonly JobType[] = jobEnvelopeSchema.options.map((option) => option.shape.type.value);

/** The only fields of a job that reach a log line (E07-S03): the ids a handler keys on, and why the job exists. */
const LOGGED_FIELDS = [
  'deliveryId',
  'githubInstallationId',
  'githubRepoId',
  'prNumber',
  'commentId',
  'githubUserId',
  'trigger',
] as const;

/**
 * The ids and the delivery a job names, for a log line: numeric ids, the delivery id and the closed `trigger`, never
 * another field. A job that carries none of them (a sweep) gives an empty object.
 */
export function logFieldsOf(job: JobEnvelope): Readonly<Record<string, string | number>> {
  const fields: Record<string, string | number> = {};
  for (const name of LOGGED_FIELDS) {
    const value: unknown = Reflect.get(job, name);
    if (typeof value === 'number' || typeof value === 'string') {
      // eslint-disable-next-line security/detect-object-injection -- name comes from the constant LOGGED_FIELDS, not from the job
      fields[name] = value;
    }
  }
  return fields;
}
