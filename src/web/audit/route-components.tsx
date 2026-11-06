// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { getRouteApi } from '@tanstack/react-router';
import { AuditPage } from './AuditPage.tsx';

// The component of the audit route (E18-S09): it reads the installation and the search from its own route, by route id, so the route
// tree does not have to import it back (`getRouteApi` is typed from the registered tree).

// type-coverage:ignore-next-line -- the route API type is made from the route tree, which holds any
const auditApi = getRouteApi('/installations/$installationId/audit');

/** The route `/installations/$installationId/audit?action=&actorGithubId=&subjectType=&subjectId=&from=&to=&cursor=`: the audit log of the tenant. */
export function AuditRoute() {
  // type-coverage:ignore-next-line -- the route API type is made from the route tree, which holds any
  const { installationId } = auditApi.useParams();
  // type-coverage:ignore-next-line -- the route API type is made from the route tree, which holds any
  const { action, actorGithubId, subjectType, subjectId, from, to, cursor } = auditApi.useSearch();
  // type-coverage:ignore-next-line -- the route API type is made from the route tree, which holds any
  const navigate = auditApi.useNavigate();
  return (
    <AuditPage
      installationId={installationId}
      filters={{ action, actorGithubId, subjectType, subjectId, from, to }}
      cursor={cursor}
      onFiltersChange={(next) => {
        void navigate({ search: next });
      }}
      onCursorChange={(next) => {
        void navigate({ search: (previous) => ({ ...previous, cursor: next }) });
      }}
      onFirstPage={() => {
        void navigate({ search: (previous) => ({ ...previous, cursor: undefined }), replace: true });
      }}
    />
  );
}
