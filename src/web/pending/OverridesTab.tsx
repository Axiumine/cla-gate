// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { InstallationRole } from '../../shared/installations.ts';
import { useT } from '../i18n/index.ts';
import { EmptyState } from '../states/EmptyState.tsx';
import { LoadingState } from '../states/LoadingState.tsx';
import { OverrideResults } from './OverrideResults.tsx';
import { RepositoryField } from './RepositoryField.tsx';
import { useRepositoryChoices } from './use-repository-choices.ts';

export interface OverridesTabProps {
  /** `installations.id` of the tenant in the address. */
  readonly installationId: number;
  /** The role of the person in this installation, when the list of installations has it: a repo admin chooses among their repositories. */
  readonly role: InstallationRole | undefined;
  readonly suspended: boolean;
  /** `?repository=` of the address: `repositories.id`, or `undefined` while none is chosen. */
  readonly repositoryId: number | undefined;
  /** `?cursor=` of the address: absent for the first page. */
  readonly cursor: string | undefined;
  readonly onRepositoryChange: (repositoryId: number | undefined) => void;
  readonly onCursorChange: (cursor: string | undefined) => void;
  readonly onFirstPage: () => void;
}

/** What stands in for the overrides while no repository of this installation is chosen: loading while the list that decides it is on its way, else the invitation to choose. */
function NoRepository({ waiting }: { readonly waiting: boolean }) {
  const t = useT();
  return waiting ? (
    <LoadingState />
  ) : (
    <EmptyState
      level={2}
      title={t('pending.overrides.choose.title')}
      description={t('pending.overrides.choose.description')}
    />
  );
}

/**
 * The second tab (E18-S08): the overrides of one repository, which has to be chosen first, because the list is kept per repository.
 * The choice is among the repositories of this installation: a repository id in the address that the list of the installation does not
 * hold is not shown (it may be another tenant's), unless the list is cut short and cannot say. Nothing is asked for until a
 * repository is chosen; the list is made for the installation and the repository, so another starts from nothing.
 */
export function OverridesTab({
  installationId,
  role,
  suspended,
  repositoryId,
  cursor,
  onRepositoryChange,
  onCursorChange,
  onFirstPage,
}: OverridesTabProps) {
  const t = useT();
  const choices = useRepositoryChoices(installationId, role);
  const { query, items, truncated } = choices;
  const known = repositoryId !== undefined && (truncated || items.some((item) => item.id === repositoryId));
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-prose text-fg-muted">{t('pending.overrides.intro')}</p>
      <RepositoryField
        choices={choices}
        value={known ? repositoryId : undefined}
        label={t('pending.overrides.repository')}
        description={t('pending.overrides.repository.help')}
        none={t('pending.overrides.repository.choose')}
        required
        byId={truncated ? (id) => t('pending.repository.byId', { id }) : undefined}
        onChange={onRepositoryChange}
      />
      {known ? (
        <OverrideResults
          key={`${String(installationId)}:${String(repositoryId)}`}
          installationId={installationId}
          repositoryId={repositoryId}
          cursor={cursor}
          onCursorChange={onCursorChange}
          onFirstPage={onFirstPage}
          suspended={suspended}
        />
      ) : (
        <NoRepository waiting={repositoryId !== undefined && query.isPending} />
      )}
    </div>
  );
}
