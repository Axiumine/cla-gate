// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { useInstallations } from '../installations/use-installations.ts';
import { usePageSubject } from '../layout/page-subject.ts';
import { EmptyState } from '../states/EmptyState.tsx';
import { LoadingState } from '../states/LoadingState.tsx';
import { Heading } from '../ui/Heading.tsx';
import { EntriesPanel } from './EntriesPanel.tsx';
import { ScopeSelect } from './ScopeSelect.tsx';

export interface AllowlistPageProps {
  /** `installations.id` of the tenant in the address. */
  readonly installationId: number;
  /** `?repository=` of the address: `repositories.id`, or `undefined` for the whole installation. */
  readonly repositoryId: number | undefined;
  /** Puts another scope in the address. */
  readonly onScopeChange: (repositoryId: number | undefined) => void;
}

/**
 * The page at `/installations/$installationId/allowlist` (E18-S06): the accounts that are exempt from signing, for the whole installation or
 * for one repository. It waits for the list of installations, because the role decides what there is to choose: an org admin starts on the
 * whole installation, a repo admin has no whole-installation scope and chooses one of their repositories first (the server refuses the
 * other with `403`). Every request is addressed through the installation or repository on screen, and the server filters by tenant.
 */
export function AllowlistPage({ installationId, repositoryId, onScopeChange }: AllowlistPageProps) {
  const t = useT();
  const installations = useInstallations();
  const installation = installations.data?.find((candidate) => candidate.id === installationId);
  usePageSubject(installation?.accountLogin);
  if (installations.isPending) {
    return <LoadingState />;
  }
  const choosing = installation?.role === 'repo_admin' && repositoryId === undefined;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Heading level={1}>{t('allowlist.title')}</Heading>
        <p className="max-w-prose text-fg-muted">{t('allowlist.intro')}</p>
      </div>
      <ScopeSelect
        installationId={installationId}
        role={installation?.role}
        repositoryId={repositoryId}
        onChange={onScopeChange}
      />
      {choosing ? (
        <EmptyState level={2} title={t('allowlist.pick.title')} description={t('allowlist.pick.description')} />
      ) : (
        <EntriesPanel
          key={repositoryId ?? 'installation'}
          installationId={installationId}
          repositoryId={repositoryId}
          installation={installation}
        />
      )}
    </div>
  );
}
