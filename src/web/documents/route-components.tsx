// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { getRouteApi } from '@tanstack/react-router';
import { DocumentPage } from './DocumentPage.tsx';
import { DocumentsPage } from './DocumentsPage.tsx';

// The components of the document routes (E18-S05): each reads its ids from its own route, by route id, so the route tree does not
// have to import them back (`getRouteApi` is typed from the registered tree).

// type-coverage:ignore-next-line -- the route API type is made from the route tree, which holds any
const documentsApi = getRouteApi('/installations/$installationId/documents');
// type-coverage:ignore-next-line -- the route API type is made from the route tree, which holds any
const documentApi = getRouteApi('/installations/$installationId/documents/$documentId');

/** The route `/installations/$installationId/documents`: the list of the documents of the tenant. */
export function DocumentsRoute() {
  // type-coverage:ignore-next-line -- the route API type is made from the route tree, which holds any
  return <DocumentsPage installationId={documentsApi.useParams().installationId} />;
}

/** The route `/installations/$installationId/documents/$documentId`: one document and its editor. */
export function DocumentRoute() {
  // type-coverage:ignore-next-line -- the route API type is made from the route tree, which holds any
  const { installationId, documentId } = documentApi.useParams();
  return <DocumentPage installationId={installationId} documentId={documentId} />;
}
