// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { githubIdSchema } from '../../../shared/github-id.ts';

// The shape of every delivery the router handles (E06-S03). Each schema declares only the fields the router (E06-S04)
// and the tenant filter (E06-S05) read and strips the rest, so a payload that grows a field is still read and nothing we
// do not use is held: not a login, not an email, not a title. The ids are the numeric GitHub ids, never the names.

/**
 * `action` is stored in `webhook_deliveries.action` (a `text` column), so it is bounded: a 10 MiB action would otherwise
 * be written to the database. It is a plain string and not an enum on purpose: an action nobody handles still
 * validates, and the router ignores it (E06-S04) instead of GitHub being told the delivery was malformed.
 */
const MAX_ACTION_LENGTH = 64;

/** GitHub's own limit for the body of a comment. */
const MAX_COMMENT_BODY_LENGTH = 65_536;

/**
 * Text that can be stored and compared: no NUL (PostgreSQL's `text` cannot hold one, so storing it is a `500` and
 * GitHub redelivers for ever) and no lone surrogate (it is not text, and it does not survive being encoded as UTF-8).
 */
function isCleanText(text: string): boolean {
  return text.isWellFormed() && !text.includes('\0');
}

const actionSchema = z.string().max(MAX_ACTION_LENGTH).refine(isCleanText);

/** A pull request or issue number: a positive safe integer, like the ids. */
const numberSchema = z.int().positive();

/** A commit id as GitHub writes it: 40 lower-case hexadecimal digits. It ends up in jobs and in API paths. */
const shaSchema = z.string().regex(/^[0-9a-f]{40}$/);

/** `{ id }`: the repository, the installation or the App a delivery names. */
const idOnlySchema = z.object({ id: githubIdSchema });

/** The account an installation belongs to. `type` is `User`, `Organization` or another kind GitHub adds: a plain string. */
const accountSchema = z.object({ id: githubIdSchema, type: z.string() });

const pullRequestPayloadSchema = z.object({
  action: actionSchema,
  number: numberSchema,
  pull_request: z.object({
    number: numberSchema,
    head: z.object({ sha: shaSchema }),
    user: accountSchema,
  }),
  repository: idOnlySchema,
  installation: idOnlySchema,
});

const checkRunPayloadSchema = z.object({
  action: actionSchema,
  check_run: z.object({ id: githubIdSchema, name: z.string(), head_sha: shaSchema, app: idOnlySchema }),
  repository: idOnlySchema,
  installation: idOnlySchema,
});

const checkSuitePayloadSchema = z.object({
  action: actionSchema,
  check_suite: z.object({ id: githubIdSchema, head_sha: shaSchema, app: idOnlySchema }),
  repository: idOnlySchema,
  installation: idOnlySchema,
});

const issueCommentPayloadSchema = z.object({
  action: actionSchema,
  issue: z.object({
    number: numberSchema,
    // Present only on a pull request, and only its presence is read: the object's own fields are stripped.
    pull_request: z.object({}).optional(),
  }),
  comment: z.object({ id: githubIdSchema, body: z.string().max(MAX_COMMENT_BODY_LENGTH).refine(isCleanText) }),
  sender: z.object({ type: z.string() }),
  repository: idOnlySchema,
  installation: idOnlySchema,
});

/** `installation` and `installation_repositories` share it: the job re-fetches the rest from the API (E05-S08). */
const installationPayloadSchema = z.object({
  action: actionSchema,
  installation: z.object({ id: githubIdSchema, account: accountSchema }),
});

const appAuthorizationPayloadSchema = z.object({
  action: actionSchema,
  sender: z.object({ id: githubIdSchema }),
});

/** An event name with the payload it must carry: one member of the union per supported event. */
function delivery<Event extends string, Payload extends z.ZodType>(event: Event, payload: Payload) {
  return z.object({ event: z.literal(event), payload });
}

/**
 * Every supported event with the schema of its payload, discriminated by the event name (`X-GitHub-Event`). The name
 * decides the schema, never the body, so a `pull_request` header over an `issue_comment` body fails here. `ping` and
 * every event nobody subscribed to are not in the union: they carry nothing the platform reads (E06-S04).
 */
export const webhookDeliverySchema = z.discriminatedUnion('event', [
  delivery('pull_request', pullRequestPayloadSchema),
  delivery('check_run', checkRunPayloadSchema),
  delivery('check_suite', checkSuitePayloadSchema),
  delivery('issue_comment', issueCommentPayloadSchema),
  delivery('installation', installationPayloadSchema),
  delivery('installation_repositories', installationPayloadSchema),
  delivery('github_app_authorization', appAuthorizationPayloadSchema),
]);

/** A delivery whose payload passed its event's schema: the event name and the stripped payload, correlated. */
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;

/** The events that have a schema. A `Set`, so a header such as `constructor` or `__proto__` (both match the header pattern) is not found on the prototype. */
const SCHEMA_EVENTS: ReadonlySet<string> = new Set(
  webhookDeliverySchema.options.map((option) => option.shape.event.value),
);

/** Whether `event` has a schema; `false` for `ping` and for every event the App is not subscribed to. */
export function hasPayloadSchema(event: string): boolean {
  return SCHEMA_EVENTS.has(event);
}
