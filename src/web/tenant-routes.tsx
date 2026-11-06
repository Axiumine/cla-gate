// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { createRoute } from '@tanstack/react-router';
import { allowlistSearchSchema } from './allowlist/allowlist-search.ts';
import { AllowlistRoute } from './allowlist/route-components.tsx';
import { auditSearchSchema } from './audit/audit-search.ts';
import { AuditRoute } from './audit/route-components.tsx';
import { documentRouteParams } from './documents/document-params.ts';
import { documentSearchSchema } from './documents/history/history-search.ts';
import { DocumentRoute, DocumentsRoute } from './documents/route-components.tsx';
import { installationRouteParams } from './installations/installation-params.ts';
import { InstallationHomeRoute, InstallationRoute } from './installations/route-components.tsx';
import { tenantPage } from './installations/tenant-page.tsx';
import { pendingSearchSchema } from './pending/pending-search.ts';
import { PendingRoute } from './pending/route-components.tsx';
import { repositorySearchSchema } from './repositories/repository-search.ts';
import { RepositoriesRoute } from './repositories/route-components.tsx';
import { rootRoute } from './root-route.ts';
import { SignaturesRoute } from './signatures/route-components.tsx';
import { signaturesSearchSchema } from './signatures/signatures-search.ts';

// The routes of one tenant (E18-S04 to E18-S11): `/installations/$installationId` and the screens below it. They are in a file of
// their own so that router.tsx, which holds the other routes and builds the tree, stays under the complexity cap of the fta check.

// One tenant (E18-S04): `$installationId` is `installations.id`, the number the API gives, never GitHub's id. A segment that is
// not a plain positive number is no page of the app. The route is the frame of every screen below it (the suspended banner), and
// the screens that E18 adds are its children; each one hands the shell the tenant switcher (`tenantPage`).
const installationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/installations/$installationId',
  ...tenantPage('installation.title'),
  params: installationRouteParams,
  component: InstallationRoute,
});

const installationHomeRoute = createRoute({
  getParentRoute: () => installationRoute,
  path: '/',
  ...tenantPage('installation.title'),
  component: InstallationHomeRoute,
});

// The repositories of a tenant (E18-S10): where enforcement is turned on, with `?q=&enabled=&cursor=` so a filtered view is shared by its address.
// Any role of the tenant opens it; the server decides which repositories a person may see and administer, on every request.
const repositoriesRoute = createRoute({
  getParentRoute: () => installationRoute,
  path: 'repositories',
  ...tenantPage('repositories.title'),
  validateSearch: repositorySearchSchema,
  component: RepositoriesRoute,
});

// The CLA documents of a tenant (E18-S05): the list, and one document with its editor and, in `?tab=history&view=&compare=&from=&to=&cursor=`, its history
// (E18-S11), so a view of it is shared by its address. `$documentId` is `cla_documents.id`; a segment
// that is not a plain positive number is no page of the app. The list needs an org admin, a document the role of its scope: the
// server decides on every request.
const documentsRoute = createRoute({
  getParentRoute: () => installationRoute,
  path: 'documents',
  ...tenantPage('documents.title'),
  component: DocumentsRoute,
});

const documentRoute = createRoute({
  getParentRoute: () => installationRoute,
  path: 'documents/$documentId',
  ...tenantPage('document.title'),
  params: documentRouteParams,
  validateSearch: documentSearchSchema,
  component: DocumentRoute,
});

// The allowlist of a tenant (E18-S06): the accounts exempt from signing, in the scope of `?repository=` (the whole installation without it). An
// org admin manages the whole installation and any repository, a repo admin the repositories they administer: the server decides on every request.
const allowlistRoute = createRoute({
  getParentRoute: () => installationRoute,
  path: 'allowlist',
  ...tenantPage('allowlist.title'),
  validateSearch: allowlistSearchSchema,
  component: AllowlistRoute,
});

// The signatures of a tenant (E18-S07): the search and the page of `?q=&state=&document=&cursor=`, so a filtered view is shared by its address.
// An org admin reads every document, a repo admin the documents of their repositories: the server decides on every request.
const signaturesRoute = createRoute({
  getParentRoute: () => installationRoute,
  path: 'signatures',
  ...tenantPage('signatures.title'),
  validateSearch: signaturesSearchSchema,
  component: SignaturesRoute,
});

// The pending pull requests and the commit overrides of a tenant (E18-S08): `?tab=&repository=&reason=&cursor=`, so a filtered view is shared by
// its address. Any role of the tenant opens it; the server decides which repositories a person may read and who may record or remove an
// override, on every request.
const pendingRoute = createRoute({
  getParentRoute: () => installationRoute,
  path: 'pending',
  ...tenantPage('pending.title'),
  validateSearch: pendingSearchSchema,
  component: PendingRoute,
});

// The audit log of a tenant (E18-S09), read-only: `?action=&actorGithubId=&subjectType=&subjectId=&from=&to=&cursor=`, so a filtered view is shared
// by its address. Only an org admin reads it: the server decides on every request, and a repo admin gets the forbidden state.
const auditRoute = createRoute({
  getParentRoute: () => installationRoute,
  path: 'audit',
  ...tenantPage('audit.title'),
  validateSearch: auditSearchSchema,
  component: AuditRoute,
});

/** The route of a tenant with the screens below it, as the router tree takes it. */
// type-coverage:ignore-next-line -- TanStack Router's route tree type holds any in its own definition (RouteWithChildren)
export const tenantRoutes = installationRoute.addChildren([
  installationHomeRoute,
  repositoriesRoute,
  documentsRoute,
  documentRoute,
  allowlistRoute,
  signaturesRoute,
  pendingRoute,
  auditRoute,
]);
