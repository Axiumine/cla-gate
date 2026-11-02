// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { routeCheckRun, routeCheckSuite } from './webhook-routing-checks.ts';
import { routeIssueComment } from './webhook-routing-comments.ts';
import { appAuthorizationFields, installationFields } from './webhook-routing-fields.ts';
import { routePullRequest } from './webhook-routing-pull-requests.ts';
import {
  type Delivery,
  ignored,
  type Router,
  type Routing,
  type RoutingContext,
  toJob,
} from './webhook-routing-types.ts';

// The routing table of the webhook intake (E06-S04): what each validated delivery becomes. Pure, so the whole table is
// a unit test. Identity is the numeric GitHub id: a job gets ids and the delivery id and nothing of the payload. The
// payload is read once, through a schema of only the fields the table needs, and none of it is copied into a job.

/**
 * The events the App is subscribed to, the ones in the `Events` row of `docs/github-app.md`. The router has exactly one
 * row for each (the type of `ROUTES` makes the compiler check it, and a test checks the document). `installation`,
 * `installation_repositories` and `github_app_authorization` always arrive, whatever the App subscribes to.
 * @internal Exported for the tests and for the App manifest (E19), which subscribes to the same list (Knip ignores `@internal` exports in production mode).
 */
export const SUBSCRIBED_EVENTS = [
  'pull_request',
  'check_run',
  'check_suite',
  'issue_comment',
  'installation',
  'installation_repositories',
  'github_app_authorization',
] as const;

type SubscribedEvent = (typeof SUBSCRIBED_EVENTS)[number];

/** GitHub's connectivity test, sent when an App is created and by the "Redeliver" and "Ping" buttons. It is answered, not routed. */
const PING_EVENT = 'ping';

/** Every action of `installation` and `installation_repositories` re-reads the installation: the job fetches the truth (E05-S08). */
function routeInstallation({ payload, context }: Delivery): Routing {
  const { installation } = installationFields.parse(payload);
  return toJob({ type: 'sync-installation', githubInstallationId: installation.id, deliveryId: context.deliveryId });
}

/** The only action of `github_app_authorization` is `revoked`: the user's sessions end (E10). */
function routeAppAuthorization({ action, payload, context }: Delivery): Routing {
  const { sender } = appAuthorizationFields.parse(payload);
  return action === 'revoked'
    ? toJob({ type: 'revoke-user-sessions', githubUserId: sender.id, deliveryId: context.deliveryId })
    : ignored('unsupported_action');
}

/** One row per subscribed event; the type fails to compile when an event of {@link SUBSCRIBED_EVENTS} has none. */
const ROUTES: Readonly<Record<SubscribedEvent, Router>> = {
  pull_request: routePullRequest,
  check_run: routeCheckRun,
  check_suite: routeCheckSuite,
  issue_comment: routeIssueComment,
  installation: routeInstallation,
  installation_repositories: routeInstallation,
  github_app_authorization: routeAppAuthorization,
};

/** A `Map`, so an event named `constructor` or `__proto__` (both pass the header pattern) finds nothing on the prototype. */
const ROUTERS: ReadonlyMap<string, Router> = new Map(Object.entries(ROUTES));

/**
 * The event names the router has a row for.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const ROUTED_EVENTS: readonly string[] = [...ROUTERS.keys()];

/**
 * Maps a delivery whose payload passed its event's schema (E06-S03) to its outcome. Pure: no I/O, no clock, and the
 * payload is read, never changed or copied into the job; the job carries numeric ids and the delivery id.
 *
 * - `ping` is answered (`pong`) and nothing is recorded.
 * - An event the App is not subscribed to is ignored (`unsupported_event`), whatever its payload.
 * - Every other delivery is exactly one job or ignored with a reason; there is no way to get two jobs.
 *
 * @param event the `X-GitHub-Event` header
 * @param action the `action` of the payload, `undefined` for an event that has none or no schema (`ping`)
 * @param payload the payload as the schema of the event left it; not read for `ping` or an unsubscribed event
 * @throws ZodError when the payload of a subscribed event lacks a field its schema guarantees: a caller bug, since a
 *   delivery that reached the router passed that schema
 */
export function routeWebhook(
  event: string,
  action: string | undefined,
  payload: unknown,
  context: RoutingContext,
): Routing {
  if (event === PING_EVENT) {
    return { kind: 'pong' };
  }
  const router = ROUTERS.get(event);
  return router === undefined ? ignored('unsupported_event') : router({ action, payload, context });
}
