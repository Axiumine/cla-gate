// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useInfiniteQuery } from '@tanstack/react-query';
import type { InstallationSummary } from '../../shared/installations.ts';
import { useApiClient } from '../auth/hooks.ts';
import { QueryBoundary } from '../states/QueryBoundary.tsx';
import { entriesQueryOptions } from './allowlist-queries.ts';
import { Entries } from './Entries.tsx';

export interface EntriesPanelProps {
  readonly installationId: number;
  /** The repository whose allowlist this is, or `undefined` for the whole installation. */
  readonly repositoryId: number | undefined;
  readonly installation: InstallationSummary | undefined;
}

/**
 * The entries of the scope the screen shows (E18-S06), read from the server for exactly that installation or repository. The screen is
 * loading until the server has answered for this scope, and an answer that is an error (`403`, the uniform `404` for a repository of
 * another tenant, GitHub down) replaces the content with that state and no entry.
 */
export function EntriesPanel({ installationId, repositoryId, installation }: EntriesPanelProps) {
  const query = useInfiniteQuery(entriesQueryOptions(useApiClient(), installationId, repositoryId));
  return (
    <QueryBoundary query={query} errorLevel={2}>
      {(view) => (
        <Entries
          installationId={installationId}
          repositoryId={repositoryId}
          installation={installation}
          view={view}
          more={{
            available: query.hasNextPage,
            loading: query.isFetchingNextPage,
            load: () => {
              void query.fetchNextPage();
            },
          }}
        />
      )}
    </QueryBoundary>
  );
}
