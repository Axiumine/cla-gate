// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { getRouteApi } from '@tanstack/react-router';
import { SignaturesPage } from './SignaturesPage.tsx';

// The component of the signatures route (E18-S07): it reads the installation and the search from its own route, by route id, so the
// route tree does not have to import it back (`getRouteApi` is typed from the registered tree).

// type-coverage:ignore-next-line -- the route API type is made from the route tree, which holds any
const signaturesApi = getRouteApi('/installations/$installationId/signatures');

/** The route `/installations/$installationId/signatures?q=&state=&document=&cursor=`: the signatures of the tenant, in the search of the address. */
export function SignaturesRoute() {
  // type-coverage:ignore-next-line -- the route API type is made from the route tree, which holds any
  const { installationId } = signaturesApi.useParams();
  // type-coverage:ignore-next-line -- the route API type is made from the route tree, which holds any
  const { q, state, document, cursor } = signaturesApi.useSearch();
  // type-coverage:ignore-next-line -- the route API type is made from the route tree, which holds any
  const navigate = signaturesApi.useNavigate();
  return (
    <SignaturesPage
      installationId={installationId}
      filters={{ q, state, document }}
      cursor={cursor}
      onFiltersChange={(filters) => {
        void navigate({ search: { q: filters.q, state: filters.state, document: filters.document } });
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
