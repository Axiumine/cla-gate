// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { InstallationSummary } from '../../shared/installations.ts';
import { useT } from '../i18n/index.ts';
import { Badge } from '../ui/Badge.tsx';
import { accountTypeKey } from './account-type.ts';
import { RoleBadge } from './RoleBadge.tsx';

export interface InstallationFactsProps {
  readonly installation: InstallationSummary;
}

/** What the list of installations says about one: the account type, the person's role, whether it is suspended and the counts. */
export function InstallationFacts({ installation }: InstallationFactsProps) {
  const t = useT();
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
      <dt>{t('installation.facts.type')}</dt>
      <dd>{t(accountTypeKey(installation.accountType))}</dd>
      <dt>{t('installation.facts.role')}</dt>
      <dd className="flex flex-wrap items-center gap-1">
        <RoleBadge role={installation.role} />
        {installation.suspended ? <Badge status="suspended" /> : null}
      </dd>
      <dt>{t('installation.facts.repositories')}</dt>
      <dd>
        {t('installation.facts.repositoriesValue', {
          total: installation.repositoryCount,
          enabled: installation.enabledCount,
        })}
      </dd>
    </dl>
  );
}
