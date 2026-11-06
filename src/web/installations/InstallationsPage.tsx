// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { QueryBoundary } from '../states/QueryBoundary.tsx';
import { Heading } from '../ui/Heading.tsx';
import { InstallationList } from './InstallationList.tsx';
import { NoInstallations } from './NoInstallations.tsx';
import { useInstallations } from './use-installations.ts';

/**
 * The page at `/installations` (E18-S04): the installations the signed-in person administers on this instance, from
 * `GET /api/installations`. An installation that the instance's admission policy has not admitted is never in the answer, so
 * there is no state for it. A failure of the list (GitHub down or limiting, `502` and `503`) is the error state with its
 * countdown, never an empty list, which would read as "you administer nothing"; an empty answer is the explanation of how to
 * install the App.
 */
export function InstallationsPage() {
  const t = useT();
  const query = useInstallations();
  return (
    <div className="flex flex-col gap-6">
      <Heading level={1}>{t('installations.title')}</Heading>
      <QueryBoundary query={query} isEmpty={(list) => list.length === 0} empty={<NoInstallations />}>
        {(list) => <InstallationList installations={list} />}
      </QueryBoundary>
    </div>
  );
}
