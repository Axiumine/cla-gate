// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Job } from './jobs.ts';

// The vocabulary of the routing table (E06-S04): what a delivery can become, and what each row of the table is given.

/**
 * Why a delivery of an installation that is stored is not acted on (E06-S05): the tenant filter turns it away before any
 * job exists. The wording is the one of the installation gate (E05-S03).
 */
export const TENANT_IGNORE_REASONS = [
  'installation_not_admitted',
  'installation_deleted',
  'installation_suspended',
] as const;

/**
 * Why a delivery of a tenant's pull request is dropped and replaced by a `sync-installation` job (E06-S05): what the
 * payload says disagrees with what is stored, and the sync is how the stored state catches up.
 */
export const REDIRECT_REASONS = ['installation_unknown', 'repository_installation_mismatch'] as const;

/** Why a delivery starts no job. The reason is a constant of this module, never text taken from the delivery. */
export const IGNORE_REASONS = [
  'unsupported_event',
  'unsupported_action',
  'foreign_check',
  'not_pull_request',
  'bot_sender',
  'no_recheck_command',
  ...TENANT_IGNORE_REASONS,
  ...REDIRECT_REASONS,
] as const;

/** One reason of {@link IGNORE_REASONS}. */
export type IgnoreReason = (typeof IGNORE_REASONS)[number];

/** What a delivery becomes: exactly one job, nothing (with the reason), or the answer to a ping. */
export type Routing =
  | { readonly kind: 'job'; readonly job: Job }
  | { readonly kind: 'ignored'; readonly reason: IgnoreReason }
  | { readonly kind: 'pong' };

/** What the router needs to know besides the delivery itself. */
export interface RoutingContext {
  /** `GITHUB_APP_ID`: the check runs and suites of this App are ours, every other App's are not. Absent, none is ours. */
  readonly appId: string | undefined;
  /** The `X-GitHub-Delivery` id of the delivery, carried by the job so that finishing it can mark the delivery processed. */
  readonly deliveryId: string;
}

/** A delivery as a row of the table receives it. */
export interface Delivery {
  /** The `action` of the payload; `undefined` when the event has none. */
  readonly action: string | undefined;
  /** The payload as the schema of its event left it. */
  readonly payload: unknown;
  readonly context: RoutingContext;
}

/** One row of the table. */
export type Router = (delivery: Delivery) => Routing;

/** The outcome "this delivery is this job". */
export const toJob = (job: Job): Routing => ({ kind: 'job', job });

/** The outcome "this delivery starts nothing, for this reason". */
export const ignored = (reason: IgnoreReason): Routing => ({ kind: 'ignored', reason });
