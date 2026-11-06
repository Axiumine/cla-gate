// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ComponentType } from 'react';
import { NotFoundPage } from '../states/index.ts';
import { REPOSITORY_ID_IN_PATH } from './repository-id.ts';

export interface RepositoryRouteProps {
  /** The parameter of the address, as the router read it. */
  readonly githubRepoId: string;
  /** The page of a repository: it takes GitHub's numeric id of the repository. */
  readonly page: ComponentType<{ readonly githubRepoId: number }>;
}

/**
 * The page of a corporate route whose address names a repository (E21-S02, E21-S04): `page` for the repository the address holds, or
 * the not-found page when the address does not hold the id of a repository (digits only, no leading zero, an exact number).
 */
export function RepositoryRoute({ githubRepoId, page: Page }: RepositoryRouteProps) {
  return REPOSITORY_ID_IN_PATH.test(githubRepoId) ? <Page githubRepoId={Number(githubRepoId)} /> : <NotFoundPage />;
}
