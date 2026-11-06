// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQuery } from '@tanstack/react-query';
import type { RepositoryPage } from '../../shared/installations.ts';
import { useApiClient } from '../auth/hooks.ts';
import { useT } from '../i18n/index.ts';
import { usePageSubject } from '../layout/page-subject.ts';
import { QueryBoundary } from '../states/QueryBoundary.tsx';
import { Heading } from '../ui/Heading.tsx';
import { UserText } from '../ui/UserText.tsx';
import { InstallationFacts } from './InstallationFacts.tsx';
import { overviewQueryOptions } from './installation-queries.ts';
import { RepositoryOverview } from './RepositoryOverview.tsx';
import { useInstallation } from './use-installations.ts';

export interface TenantOverviewProps {
  /** `installations.id` of the tenant in the address. */
  readonly installationId: number;
}

interface OverviewProps extends TenantOverviewProps {
  readonly page: RepositoryPage;
}

/** What is shown once the server has answered for the tenant: the account, what the list says of it, and its first repositories. */
function Overview({ installationId, page }: OverviewProps) {
  const t = useT();
  const installation = useInstallation(installationId);
  usePageSubject(installation?.accountLogin);
  return (
    <div className="flex flex-col gap-6">
      <Heading level={1}>
        {installation === undefined ? t('installation.title') : <UserText>{installation.accountLogin}</UserText>}
      </Heading>
      {installation === undefined ? null : <InstallationFacts installation={installation} />}
      <section className="flex flex-col gap-3">
        <Heading level={2}>{t('installation.repositories.title')}</Heading>
        <RepositoryOverview page={page} />
      </section>
    </div>
  );
}

/**
 * The page at `/installations/$installationId` (E18-S04): one tenant. Everything on it is shown only after the server has
 * answered for this installation (`GET /api/installations/:installationId/repositories`), so an installation the person cannot
 * open, which the server answers `404` for (an unknown id, no role there, not admitted) or `403`, shows that state and none of
 * the tenant's data, not even its name. The query key starts with the installation, and nothing carries over from the tenant
 * that was open before: while another tenant's answer is awaited the page is loading.
 */
export function TenantOverview({ installationId }: TenantOverviewProps) {
  const query = useQuery(overviewQueryOptions(useApiClient(), installationId));
  return (
    <QueryBoundary query={query} errorLevel={1}>
      {(page) => <Overview installationId={installationId} page={page} />}
    </QueryBoundary>
  );
}
