// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { TENANT, UNSTORED_REPOSITORY } from '../../../services/tenant-fixture/test-support.ts';
import { ABSENT, FIXTURE_IDS, webhookFixture, withValue } from '../../github/webhook-fixture/test-support.ts';
import { deliveryHeaders } from '../test-support.ts';

// The rows of the routing table (E06-S04, S05) as the request-path tests of E06-S07 use them: one delivery per row, with
// what the route answers, what the `webhook.received` line says and which statements the request sends to the database.
// One table, so "every row of the routing table" means the same rows in every one of those tests.

/** The kinds of statement the request path sends, as the Kysely plugin of `countingDatabase` names them. */
export const SQL = {
  /** The installation lookup, the repository lookup, and the `select ... for update` of a delivery recorded before. */
  select: 'SelectQueryNode',
  insert: 'InsertQueryNode',
  /** The fake enqueuer's own insert into its table (the pg-boss adapter sends one statement too). */
  enqueue: 'RawNode',
} as const;

type Statement = (typeof SQL)[keyof typeof SQL];

const READS_THEN_JOB: readonly Statement[] = [SQL.select, SQL.select, SQL.insert, SQL.enqueue];
const NOTHING: readonly Statement[] = [];

export interface RoutingRow {
  readonly label: string;
  readonly event: string;
  readonly payload: () => Record<string, unknown>;
  readonly status: 200 | 202;
  /** The body of the answer. */
  readonly answer: Readonly<Record<string, string>>;
  /** What the `webhook.received` line says. */
  readonly received: {
    readonly action: string | null;
    readonly githubInstallationId: number | null;
    readonly outcome: 'accepted' | 'ignored';
    readonly reason: string | null;
  };
  /** The statements sent for the first delivery of the row, in order. */
  readonly statements: readonly Statement[];
}

const ACCEPTED = { status: 'accepted' };
const ignoredFor = (reason: string) => ({ status: 'ignored', reason });

/** A fixture of `event` with the values at the dotted paths replaced: what a row delivers. */
interface Source {
  readonly event: string;
  readonly payload: () => Record<string, unknown>;
}

const fixture = (
  event: Parameters<typeof webhookFixture>[0],
  changes: readonly (readonly [string, unknown])[] = [],
): Source => ({
  event,
  payload: () => changes.reduce((payload, [path, value]) => withValue(payload, path, value), webhookFixture(event)),
});

function installationOf(payload: Record<string, unknown>): number | null {
  const installation = payload['installation'];
  const id: unknown =
    typeof installation === 'object' && installation !== null ? Reflect.get(installation, 'id') : undefined;
  return typeof id === 'number' ? id : null;
}

/** Every fixture of an event with a schema has an `action`. */
function actionOf(payload: Record<string, unknown>): string {
  return String(payload['action']);
}

/** An accepted row: the event was routed to one job. */
function accepted(label: string, source: Source, statements: readonly Statement[] = READS_THEN_JOB): RoutingRow {
  const body = source.payload();
  return {
    label,
    event: source.event,
    payload: source.payload,
    status: 202,
    answer: ACCEPTED,
    received: { action: actionOf(body), githubInstallationId: installationOf(body), outcome: 'accepted', reason: null },
    statements,
  };
}

/** An ignored row: the delivery starts no job, for `reason`. */
function ignored(
  label: string,
  source: Source,
  reason: string,
  statements: readonly Statement[] = NOTHING,
): RoutingRow {
  const body = source.payload();
  return {
    label,
    event: source.event,
    payload: source.payload,
    status: 202,
    answer: ignoredFor(reason),
    received: { action: actionOf(body), githubInstallationId: installationOf(body), outcome: 'ignored', reason },
    statements,
  };
}

const prTenant = (tenant: { installation: number; repository: number }) =>
  fixture('pull_request', [
    ['installation.id', tenant.installation],
    ['repository.id', tenant.repository],
  ]);

/** The row the tests that need one ordinary accepted delivery use. */
export const OPENED_PULL_REQUEST = accepted('pull_request opened', fixture('pull_request'));

/** Every row of the routing table, and of the tenant filter that stands in front of its pull request, check and comment jobs. */
export const ROUTING_ROWS: readonly RoutingRow[] = [
  OPENED_PULL_REQUEST,
  ...['reopened', 'synchronize', 'edited', 'ready_for_review', 'closed'].map((action) =>
    accepted(`pull_request ${action}`, fixture('pull_request', [['action', action]])),
  ),
  ignored('pull_request labeled', fixture('pull_request', [['action', 'labeled']]), 'unsupported_action'),
  accepted('check_run rerequested', fixture('check_run')),
  ignored('check_run completed', fixture('check_run', [['action', 'completed']]), 'unsupported_action'),
  ignored('check_run of another check', fixture('check_run', [['check_run.name', 'ci/build']]), 'foreign_check'),
  accepted('check_suite rerequested', fixture('check_suite')),
  ignored(
    'check_suite of another App',
    fixture('check_suite', [['check_suite.app.id', FIXTURE_IDS.app + 1]]),
    'foreign_check',
  ),
  accepted('issue_comment created with /recheck', fixture('issue_comment')),
  ignored(
    'issue_comment without /recheck',
    fixture('issue_comment', [['comment.body', 'Looks good to me.']]),
    'no_recheck_command',
  ),
  ignored('issue_comment of a Bot', fixture('issue_comment', [['sender.type', 'Bot']]), 'bot_sender'),
  ignored('issue_comment on an issue', fixture('issue_comment', [['issue.pull_request', ABSENT]]), 'not_pull_request'),
  accepted('installation created', fixture('installation'), [SQL.insert, SQL.enqueue]),
  accepted('installation_repositories added', fixture('installation_repositories'), [SQL.insert, SQL.enqueue]),
  accepted('github_app_authorization revoked', fixture('github_app_authorization'), [SQL.insert, SQL.enqueue]),
  {
    label: 'ping',
    event: 'ping',
    payload: () => ({ zen: 'Keep it logically awesome.', hook_id: 1 }),
    status: 200,
    answer: { status: 'pong' },
    received: { action: null, githubInstallationId: null, outcome: 'ignored', reason: 'ping' },
    statements: NOTHING,
  },
  {
    label: 'push (an event nobody subscribed to)',
    event: 'push',
    payload: () => ({ ref: 'refs/heads/main' }),
    status: 202,
    answer: ignoredFor('unsupported_event'),
    received: { action: null, githubInstallationId: null, outcome: 'ignored', reason: 'unsupported_event' },
    statements: NOTHING,
  },
  ignored('pull_request of a rejected installation', prTenant(TENANT.rejected), 'installation_not_admitted', [
    SQL.select,
  ]),
  ignored('pull_request of a suspended installation', prTenant(TENANT.suspended), 'installation_suspended', [
    SQL.select,
  ]),
  ignored('pull_request of a deleted installation', prTenant(TENANT.deleted), 'installation_deleted', [SQL.select]),
  ignored('pull_request of an unknown installation', prTenant(TENANT.unknown), 'installation_unknown', [
    SQL.select,
    SQL.insert,
    SQL.enqueue,
  ]),
  ignored(
    'pull_request of a repository stored under another installation',
    fixture('pull_request', [['repository.id', TENANT.other.repository]]),
    'repository_installation_mismatch',
    READS_THEN_JOB,
  ),
  accepted(
    'pull_request of a repository the instance has not stored yet',
    fixture('pull_request', [['repository.id', UNSTORED_REPOSITORY]]),
  ),
];

/** The delivery id of the `index`-th delivery of a test: a distinct UUID, so no two deliveries are the same one. */
export function deliveryIdOf(index: number): string {
  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

/** The text and the signed headers of the `index`-th delivery, which is the row `row`. */
export function deliveryOf(row: RoutingRow, index: number): { body: string; headers: Record<string, string> } {
  const body = JSON.stringify(row.payload());
  return {
    body,
    headers: deliveryHeaders(body, {
      headers: { 'x-github-event': row.event, 'x-github-delivery': deliveryIdOf(index) },
    }),
  };
}
