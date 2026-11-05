// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Navigate } from '@tanstack/react-router';
import type { InstallationSummary } from '../../shared/installations.ts';
import { useT } from '../i18n/index.ts';
import { useInstallLink } from '../meta/meta.ts';
import { LoadingState } from '../states/LoadingState.tsx';
import { StatusMessage } from '../ui/StatusMessage.tsx';
import { InstallAnchor } from './InstallAnchor.tsx';
import { InstallationsTable } from './InstallationsTable.tsx';

export interface InstallationListProps {
  /** The installations of the person: at least one. */
  readonly installations: readonly InstallationSummary[];
}

/**
 * A person who administers installations (E18-S04). With exactly one the page goes straight into it, replacing its own entry
 * in the history so Back does not return to a page that only redirects. With several it is the table, the notice that the list
 * may be incomplete when GitHub's limit cut the search short, and the link that installs the App on another account.
 */
export function InstallationList({ installations }: InstallationListProps) {
  const t = useT();
  const install = useInstallLink();
  const [only] = installations;
  if (only !== undefined && installations.length === 1) {
    return (
      <>
        <LoadingState />
        <Navigate to="/installations/$installationId" params={{ installationId: only.id }} replace />
      </>
    );
  }
  return (
    <>
      {installations.some(({ truncated }) => truncated) ? (
        <StatusMessage tone="info">{t('installation.truncated')}</StatusMessage>
      ) : null}
      <InstallationsTable installations={installations} />
      {install.kind === 'link' ? <InstallAnchor href={install.href}>{t('installations.install')}</InstallAnchor> : null}
    </>
  );
}
