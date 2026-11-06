// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { NotFoundPage } from '../states/NotFoundPage.tsx';
import { QueryBoundary } from '../states/QueryBoundary.tsx';
import { OperatorInstallations } from './OperatorInstallations.tsx';
import { useOperator } from './use-operator.ts';

/**
 * The page at `/operator/installations` (E18-S13): the installations of the instance, for its operator. The server answers `404` to
 * everyone else, and that is the not-found page here, the one a typo gets, with no heading of this page before it: whoever is not
 * the operator learns nothing of the route. Any other failure is the error state with its retry, never the empty table.
 */
export function OperatorPage() {
  const query = useOperator();
  return (
    <QueryBoundary query={query} errorLevel={1}>
      {(view) => (view.operator ? <OperatorInstallations installations={view.installations} /> : <NotFoundPage />)}
    </QueryBoundary>
  );
}
