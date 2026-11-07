// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { AUDIT_EXEMPT_REASONS } from '../audit-routes.ts';

// The mutating routes that the stories of E11 to E16 and E19 name, with the audit action each story documents (E16-S01).
// The application's route table is held to it: a route that is registered must declare what its story says, and a row that
// says a route is built while the application does not register it (or the reverse) fails, so the table is never stale.

/** What a story documents for the audit of a route: one of these actions, or an exemption with its reason. */
type Documented = { readonly audit: readonly string[] } | { readonly exempt: string };

export interface DocumentedMutation {
  /** `METHOD /path`, the path as the story writes it, with its parameters. */
  readonly route: string;
  readonly story: string;
  readonly documents: Documented;
  /** True once the application registers the route. Flip it in the change that adds the route. */
  readonly built: boolean;
}

const INSTALLATION = '/api/installations/:installationId';
const REPOSITORY = '/api/repositories/:repositoryId';
const DOCUMENT = `${INSTALLATION}/documents/:documentId`;

const audited = (route: string, story: string, ...actions: string[]): DocumentedMutation => ({
  route,
  story,
  documents: { audit: actions },
  built: false,
});

/** The same row once the application registers the route: the change that adds the route flips it. */
const registered = (entry: DocumentedMutation): DocumentedMutation => ({ ...entry, built: true });

const exempt = (route: string, story: string, reason: string, built = false): DocumentedMutation => ({
  route,
  story,
  documents: { exempt: reason },
  built,
});

/** Every mutating route the stories of E11 to E16 and E19 name, in story order. */
export const DOCUMENTED_MUTATIONS: readonly DocumentedMutation[] = [
  exempt('POST /webhooks/github', 'E11-S01', 'webhook', true),
  exempt('POST /api/auth/logout', 'E10-S06', 'session', true),
  registered(audited(`POST ${INSTALLATION}/documents`, 'E12-S01', 'cla_document.created')),
  registered(audited(`PATCH ${DOCUMENT}`, 'E12-S01', 'cla_document.renamed')),
  registered(audited(`PUT ${DOCUMENT}/draft`, 'E12-S03', 'cla_draft.saved')),
  registered(audited(`DELETE ${DOCUMENT}/draft`, 'E12-S03', 'cla_draft.discarded')),
  registered(audited(`POST ${DOCUMENT}/versions`, 'E12-S04', 'cla_version.published')),
  registered(audited('POST /api/sign', 'E13-S04', 'signature.created')),
  registered(
    audited(
      `PUT ${REPOSITORY}/cla-document`,
      'E14-S02',
      'repository.cla_document_attached',
      'repository.cla_document_detached',
    ),
  ),
  registered(audited(`POST ${REPOSITORY}/enable`, 'E14-S03', 'repository.enabled')),
  registered(audited(`POST ${REPOSITORY}/disable`, 'E14-S04', 'repository.disabled')),
  registered(audited(`POST ${INSTALLATION}/allowlist-entries`, 'E14-S06', 'allowlist_entry.created')),
  registered(audited(`POST ${REPOSITORY}/allowlist-entries`, 'E14-S06', 'allowlist_entry.created')),
  registered(audited(`DELETE ${INSTALLATION}/allowlist-entries/:entryId`, 'E14-S07', 'allowlist_entry.deleted')),
  registered(audited(`POST ${INSTALLATION}/signatures/:signatureId/revoke`, 'E15-S03', 'signature.revoked')),
  registered(audited(`POST ${DOCUMENT}/invalidations`, 'E15-S04', 'signatures.invalidated')),
  registered(audited(`POST ${REPOSITORY}/commit-overrides`, 'E15-S05', 'commit_override.created')),
  registered(audited(`DELETE ${REPOSITORY}/commit-overrides/:overrideId`, 'E15-S06', 'commit_override.deleted')),
  { ...audited(`POST ${INSTALLATION}/erasures`, 'E16-S04', 'signer_pii.erased'), built: true },
  registered(audited('POST /api/corporate/agreements', 'E21-S02', 'corporate_agreement.signed')),
  registered(
    audited(
      `PUT ${INSTALLATION}/repositories/:repositoryId/corporate-document`,
      'E21-S02',
      'repository.corporate_document_set',
    ),
  ),
  registered(audited('POST /api/corporate/agreements/:agreementId/approvals', 'E21-S03', 'corporate_approval.added')),
  registered(
    audited(
      'DELETE /api/corporate/agreements/:agreementId/approvals/:approvalId',
      'E21-S03',
      'corporate_approval.revoked',
    ),
  ),
  registered(
    audited('POST /api/corporate/agreements/:agreementId/approvals/carry-over', 'E21-S03', 'corporate_approval.added'),
  ),
  registered(audited('POST /api/corporate/repositories/:githubRepoId/claims', 'E21-S04', 'corporate_approval.derived')),
  exempt('POST /api/setup/unlock', 'E19-S06', 'setup', true),
  exempt('POST /api/setup/manifest', 'E19-S06', 'setup', true),
  exempt('POST /api/setup/convert', 'E19-S11', 'setup', true),
  registered(
    audited(
      `PUT ${INSTALLATION}/repositories/:repositoryId/public-verification`,
      'E22-S02',
      'repository.public_verification_changed',
    ),
  ),
];

/** A mutating route of the application as registered, with the audit declaration of its config. */
export interface RegisteredRoute {
  /** `METHOD /path`. */
  readonly name: string;
  readonly audit: string | undefined;
  readonly exempt: string | undefined;
}

const declaredOf = (route: RegisteredRoute): string => route.audit ?? route.exempt ?? 'nothing';

/** What the story documents, as a phrase, when the route declares something else; `undefined` when it declares what is documented. */
function unmet(documents: Documented, route: RegisteredRoute): string | undefined {
  if ('audit' in documents) {
    return route.audit !== undefined && documents.audit.includes(route.audit)
      ? undefined
      : documents.audit.join(' or ');
  }
  return route.exempt === documents.exempt ? undefined : `the exemption ${documents.exempt}`;
}

/** The problem of one documented mutation held to the route the application registered for it, if any. */
function mismatch(entry: DocumentedMutation, route: RegisteredRoute | undefined): string[] {
  if (entry.built !== (route !== undefined)) {
    return [`${entry.route} (${entry.story}) is ${entry.built ? 'not ' : ''}registered: set built to ${!entry.built}`];
  }
  const wanted = route === undefined ? undefined : unmet(entry.documents, route);
  return route === undefined || wanted === undefined
    ? []
    : [`${entry.route} declares ${declaredOf(route)}, ${entry.story} documents ${wanted}`];
}

/** The routes the table documents for `action`. */
const documentedFor = (table: readonly DocumentedMutation[], action: string): string[] =>
  table
    .filter((entry) => 'audit' in entry.documents && entry.documents.audit.includes(action))
    .map((entry) => entry.route);

/** The problem of a route that declares an action the table documents for other routes only. */
function stray(table: readonly DocumentedMutation[], route: RegisteredRoute): string[] {
  const owners = route.audit === undefined ? [] : documentedFor(table, route.audit);
  return owners.length === 0 || owners.includes(route.name)
    ? []
    : [`${route.name} declares ${route.audit}, which the table documents for ${owners.join(', ')}`];
}

/**
 * What is wrong with the route table `registered` held to `table`: a `built` flag that differs from the registration, a
 * route that declares something else than its story documents, a route that declares an action the table documents for
 * another route (the story's path changed: update the table), and an exemption reason outside the closed list.
 */
export function routeProblems(table: readonly DocumentedMutation[], registered: readonly RegisteredRoute[]): string[] {
  const byName = new Map(registered.map((route) => [route.name, route]));
  return [
    ...table.flatMap((entry) => mismatch(entry, byName.get(entry.route))),
    ...registered.flatMap((route) => stray(table, route)),
    ...registered
      .filter((route) => route.exempt !== undefined && !AUDIT_EXEMPT_REASONS.some((reason) => reason === route.exempt))
      .map(
        (route) =>
          `${route.name} declares the exemption ${route.exempt}, which is not one of ${AUDIT_EXEMPT_REASONS.join(', ')}`,
      ),
  ];
}
