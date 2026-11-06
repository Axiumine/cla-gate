// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQuery } from '@tanstack/react-query';
import type { InstallationRole } from '../../shared/installations.ts';
import { useApiClient } from '../auth/hooks.ts';
import { SCOPE_REPOSITORIES, scopeRepositoriesQueryOptions } from '../documents/document-queries.ts';
import { type Messages, type Translate, useT } from '../i18n/index.ts';
import { ErrorState } from '../states/ErrorState.tsx';
import { Field, Select, type SelectOption } from '../ui/index.ts';

/** A repository of the scope list, as far as the choices need it. */
interface ListedRepository {
  readonly id: number;
  readonly fullName: string;
}

/**
 * The choices of the scope select: the whole installation (for a repo admin a disabled prompt instead, since that scope is not theirs),
 * the repositories listed, and the repository of the address when the list does not hold it, named by its id.
 */
function scopeOptions(
  t: Translate<Messages>,
  scope: {
    readonly role: InstallationRole | undefined;
    readonly repositoryId: number | undefined;
    readonly items: readonly ListedRepository[];
  },
): readonly SelectOption[] {
  const { role, repositoryId, items } = scope;
  const first: SelectOption =
    role === 'repo_admin'
      ? { value: '', label: t('allowlist.scope.choose'), disabled: true }
      : { value: '', label: t('allowlist.scope.installation') };
  const listed = items.map(({ id, fullName }) => ({ value: String(id), label: fullName }));
  if (repositoryId === undefined || items.some((item) => item.id === repositoryId)) {
    return [first, ...listed];
  }
  return [
    first,
    ...listed,
    { value: String(repositoryId), label: t('allowlist.scope.repositoryById', { id: repositoryId }) },
  ];
}

export interface ScopeSelectProps {
  readonly installationId: number;
  /** The role of the person in this installation, when the list of installations has it: a repo admin has no whole-installation scope. */
  readonly role: InstallationRole | undefined;
  /** The repository the screen shows, or `undefined` for the whole installation. */
  readonly repositoryId: number | undefined;
  readonly onChange: (repositoryId: number | undefined) => void;
}

/**
 * The scope the screen shows (E18-S06): the whole installation, which only an org admin manages, or one of the first repositories of the
 * tenant by name (for a repo admin, those they administer). A repository in the address that the list does not hold (beyond the first
 * hundred) is still a choice, named by its id; the server decides whether the person may see it. A line says when there are more
 * repositories than are listed, and the error state when the list cannot be read (the whole installation stays a choice).
 */
export function ScopeSelect({ installationId, role, repositoryId, onChange }: ScopeSelectProps) {
  const t = useT();
  const repositories = useQuery(scopeRepositoriesQueryOptions(useApiClient(), installationId));
  const listed = repositories.data;
  const items = (listed?.items ?? []).filter((item) => role !== 'repo_admin' || item.canAdminister);
  const options = scopeOptions(t, { role, repositoryId, items });
  return (
    <div className="flex flex-col gap-2">
      <Field label={t('allowlist.scope')} description={t('allowlist.scope.help')}>
        <Select
          options={options}
          value={repositoryId === undefined ? '' : String(repositoryId)}
          disabled={repositories.isPending}
          onChange={(event) => {
            onChange(event.target.value === '' ? undefined : Number(event.target.value));
          }}
        />
      </Field>
      {repositories.isError ? (
        <ErrorState
          variant="banner"
          error={repositories.error}
          refetch={repositories.refetch}
          retrying={repositories.isFetching}
        />
      ) : null}
      {(listed?.nextCursor ?? null) === null ? null : (
        <p className="text-sm text-fg-muted">{t('allowlist.scope.more', { count: SCOPE_REPOSITORIES })}</p>
      )}
    </div>
  );
}
