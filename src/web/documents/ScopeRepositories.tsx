// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../auth/hooks.ts';
import { useT } from '../i18n/index.ts';
import { ErrorState } from '../states/ErrorState.tsx';
import { SCOPE_REPOSITORIES, scopeRepositoriesQueryOptions } from './document-queries.ts';
import { ScopeField } from './ScopeField.tsx';

export interface ScopeRepositoriesProps {
  readonly installationId: number;
  readonly value: string;
  readonly onChange: (scope: string) => void;
}

/**
 * The scope choice of the new-document dialog with the repositories it offers (E18-S05): the first repositories of the tenant, a
 * line that says so when there are more than are listed, and the error state when the list cannot be read (the whole-installation
 * choice stays, so a document of the whole installation can still be created).
 */
export function ScopeRepositories({ installationId, value, onChange }: ScopeRepositoriesProps) {
  const t = useT();
  const repositories = useQuery(scopeRepositoriesQueryOptions(useApiClient(), installationId));
  const listed = repositories.data;
  return (
    <>
      <ScopeField
        value={value}
        repositories={listed?.items ?? []}
        loading={repositories.isPending}
        onChange={onChange}
      />
      {repositories.isError ? (
        <ErrorState
          variant="banner"
          error={repositories.error}
          refetch={repositories.refetch}
          retrying={repositories.isFetching}
        />
      ) : null}
      {(listed?.nextCursor ?? null) === null ? null : (
        <p className="text-sm text-fg-muted">{t('documents.new.moreRepositories', { count: SCOPE_REPOSITORIES })}</p>
      )}
    </>
  );
}
