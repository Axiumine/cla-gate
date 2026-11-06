// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { EmptyState } from '../states/EmptyState.tsx';
import { Heading } from '../ui/Heading.tsx';
import { OperatorTable } from './OperatorTable.tsx';
import type { OperatorInstallation } from './operator-queries.ts';

export interface OperatorInstallationsProps {
  readonly installations: readonly OperatorInstallation[];
}

/**
 * What the operator sees (E18-S13): the page's `h1`, the two things the catalog explains (admission is the instance configuration and
 * is not changed here; operating the platform opens no tenant), and the table, or the empty state of an instance no account has
 * installed the App on. Nothing on it changes anything.
 */
export function OperatorInstallations({ installations }: OperatorInstallationsProps) {
  const t = useT();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Heading level={1}>{t('operator.title')}</Heading>
        <p className="max-w-prose text-fg-muted">{t('operator.intro')}</p>
        <p className="max-w-prose text-fg-muted">{t('operator.admission.note')}</p>
        <p className="max-w-prose text-fg-muted">{t('operator.access.note')}</p>
      </div>
      {installations.length === 0 ? (
        <EmptyState level={2} title={t('operator.empty.title')} description={t('operator.empty.description')} />
      ) : (
        <OperatorTable installations={installations} />
      )}
    </div>
  );
}
