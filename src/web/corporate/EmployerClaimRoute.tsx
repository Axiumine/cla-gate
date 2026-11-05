// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useParams } from '@tanstack/react-router';
import { NotFoundPage } from '../states/index.ts';
import { EmployerClaimPage } from './EmployerClaimPage.tsx';
import { REPOSITORY_ID_IN_PATH } from './repository-id.ts';

/**
 * The page of the route `/corporate/claim/$githubRepoId` (E21-S04): the claim of an employee for the repository the address names, or the
 * not-found page when the address does not hold the id of a repository (digits only, no leading zero, an exact number).
 */
export function EmployerClaimRoute() {
  const { githubRepoId } = useParams({ strict: false });
  return githubRepoId !== undefined && REPOSITORY_ID_IN_PATH.test(githubRepoId) ? (
    <EmployerClaimPage githubRepoId={Number(githubRepoId)} />
  ) : (
    <NotFoundPage />
  );
}
