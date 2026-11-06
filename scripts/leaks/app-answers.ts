// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sessionRoute } from '../../src/shared/auth-contract.ts';
import { documentListRoute, documentRoute, readDraftRoute, versionRoute } from '../../src/shared/cla-routes.ts';
import { fillPath, type Route, responseSchemaFor } from '../../src/shared/contract.ts';
import { installationListRoute, installationRepositoriesRoute } from '../../src/shared/installations.ts';
import { metaRoute } from '../../src/shared/meta.ts';

// E18-S12: what the API says to the dashboard in the leak scenarios of the screens. Every body is parsed against the schema
// the route declares for its 200 when the table is built, so the made-up server cannot drift from the contract: a body that
// no longer fits stops the run with the route's name, instead of making a screen draw its error state and a scenario measure
// that. All values are made up.

/** One answer: the route it is for, the path it is served at (a path the route's template makes), and the body. */
export interface AppAnswer {
  readonly route: Route;
  readonly path: string;
  readonly body: unknown;
}

/** `route.path` with its `:placeholders` filled in from `params`. */
function pathOf(route: Route, params: Readonly<Record<string, number>>): string {
  const values = new Map(Object.entries(params));
  return fillPath(route.path, (name) => String(values.get(name)));
}

/**
 * The answer of `route` for `params`; throws, naming the route, when `body` is not what the route's 200 is.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export function answerOf(route: Route, params: Readonly<Record<string, number>>, body: unknown): AppAnswer {
  const schema = responseSchemaFor(route, 200);
  if (!schema?.safeParse(body).success) {
    throw new Error(`the made-up answer of ${route.name} does not fit its schema`);
  }
  return { route, path: pathOf(route, params), body };
}

const NOW = '2026-03-10T09:45:00.000Z';
const FINGERPRINT = '0123456789abcdef'.repeat(4);
const TEXT = '# Individual Contributor Agreement\n\nMade-up text.\n';

/** The two tenants the viewer administers, and the one document each lists. */
const TENANTS = [
  { id: 9001, login: 'alice-oss', document: { id: 9201, name: 'Individual CLA', repository: 'alice-oss/widgets' } },
  { id: 9002, login: 'alice-labs', document: { id: 9202, name: 'Labs CLA', repository: 'alice-labs/lab' } },
] as const;

function documentOf(tenant: (typeof TENANTS)[number]) {
  return {
    id: tenant.document.id,
    name: tenant.document.name,
    kind: 'individual',
    scope: 'installation',
    repositoryId: null,
    activeVersion: { id: tenant.document.id + 100, major: 1, minor: 0, contentSha256: FINGERPRINT, publishedAt: NOW },
    createdAt: NOW,
    updatedAt: NOW,
    hasDraft: true,
  };
}

/** What the documents screen and the editor of a tenant read: the list, one document, its draft and its active version. */
function documentAnswers(tenant: (typeof TENANTS)[number]): AppAnswer[] {
  const installationId = tenant.id;
  const documentId = tenant.document.id;
  const document = documentOf(tenant);
  return [
    answerOf(
      documentListRoute,
      { installationId },
      {
        documents: [{ ...document, repositoryFullName: null }],
        nextCursor: null,
      },
    ),
    answerOf(documentRoute, { installationId, documentId }, { document }),
    answerOf(
      readDraftRoute,
      { installationId, documentId },
      {
        draft: { contentMd: TEXT, revision: 1, updatedAt: NOW },
      },
    ),
    answerOf(
      versionRoute,
      { installationId, documentId, versionId: document.activeVersion.id },
      {
        version: {
          ...document.activeVersion,
          publishedBy: { githubId: 4100101, login: 'alice-maintainer' },
          rationale: 'First version.',
          active: true,
          signatureCount: 0,
          contentMd: TEXT,
        },
      },
    ),
  ];
}

/** The repositories of a tenant, which the dialog of a new document asks for when it opens. */
function repositoryAnswer(tenant: (typeof TENANTS)[number]): AppAnswer {
  const installationId = tenant.id;
  return answerOf(
    installationRepositoriesRoute,
    { installationId },
    {
      items: [
        {
          id: installationId + 100,
          githubRepoId: installationId + 70_000_000,
          fullName: tenant.document.repository,
          enabled: false,
          canAdminister: true,
          document: null,
        },
      ],
      nextCursor: null,
    },
  );
}

/** Every answer of the made-up API: the session, the build's source link, the installations and what each of them lists. */
export const APP_ANSWERS: readonly AppAnswer[] = [
  answerOf(
    sessionRoute,
    {},
    {
      user: { githubId: 4100101, login: 'alice-maintainer', name: 'Alice Maintainer', avatarUrl: null },
      expiresAt: '2026-12-31T00:00:00Z',
      csrfToken: 'A'.repeat(43),
    },
  ),
  answerOf(metaRoute, {}, { sourceUrl: 'https://github.com/Axiumine/cla-gate', commit: null, installUrl: null }),
  answerOf(
    installationListRoute,
    {},
    TENANTS.map((tenant) => ({
      id: tenant.id,
      accountLogin: tenant.login,
      accountType: 'User',
      role: 'org_admin',
      suspended: false,
      repositoryCount: 1,
      enabledCount: 0,
      truncated: false,
    })),
  ),
  ...TENANTS.flatMap((tenant) => [...documentAnswers(tenant), repositoryAnswer(tenant)]),
];

/** The body for each path, which is what `serveApp` answers from. */
export function answerTable(answers: readonly AppAnswer[] = APP_ANSWERS): ReadonlyMap<string, unknown> {
  return new Map(answers.map((answer) => [answer.path, answer.body]));
}
