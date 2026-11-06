// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import type { OperatorInstallation } from './operator-queries.ts';

/** How many repositories an installation has (E18-S13): stored and not removed, of those the ones that enforce the CLA, and the ones removed. Numbers only. */
export function RepositoryCounts({ repositories }: { readonly repositories: OperatorInstallation['repositories'] }) {
  const t = useT();
  return (
    <ul className="flex flex-col gap-1">
      <li>{t('operator.repositories.active', { count: repositories.active })}</li>
      <li>{t('operator.repositories.enabled', { count: repositories.enabled })}</li>
      <li>{t('operator.repositories.removed', { count: repositories.removed })}</li>
    </ul>
  );
}
