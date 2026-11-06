// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useApiClient } from '../auth/hooks.ts';
import { ErrorState } from '../states/ErrorState.tsx';
import { LoadingState } from '../states/LoadingState.tsx';
import type { HeadingLevel } from '../ui/Heading.tsx';
import { repositoryDocumentsQueryOptions } from './repository-documents-query.ts';

export interface RepositoryGateProps {
  /** `installations.id` of the tenant in the address. */
  readonly installationId: number;
  /** `?repository=` of the address: the repository the screen is about. */
  readonly repositoryId: number;
  /** The heading level of the error state that replaces the screen. */
  readonly errorLevel?: HeadingLevel;
  /** The screen for the repository. It is drawn only once the installation in the address has said that the repository is its own. */
  readonly children: ReactElement;
}

/**
 * Lets a screen about one repository show it only when the repository belongs to the installation in the address. The allowlist and
 * the overrides of a repository are addressed by the repository id alone, and the server judges the person by the tenant that owns
 * the repository, so a person who administers two tenants and follows a link that puts a repository of one under the page of the other
 * would be shown the other tenant's data under this tenant's name, and would change it from there. The check is a call through the
 * installation in the address (`GET /api/installations/:installationId/repositories/:repositoryId/documents`, which answers the
 * uniform `404` for a repository of another installation), made on every visit; nothing about the repository is asked for before it
 * has answered, and an answer that is not a success (the `404`, a refusal, a failure) is the error state, never the screen.
 */
export function RepositoryGate({ installationId, repositoryId, errorLevel = 2, children }: RepositoryGateProps) {
  const membership = useQuery(repositoryDocumentsQueryOptions(useApiClient(), installationId, repositoryId));
  if (membership.isError) {
    return (
      <ErrorState
        error={membership.error}
        refetch={membership.refetch}
        retrying={membership.isFetching}
        level={errorLevel}
      />
    );
  }
  return membership.data === undefined ? <LoadingState /> : children;
}
