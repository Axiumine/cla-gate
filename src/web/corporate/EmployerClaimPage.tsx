// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { QueryBoundary } from '../states/index.ts';
import { Heading } from '../ui/Heading.tsx';
import { EmployerClaim } from './EmployerClaim.tsx';
import { useAvailability } from './use-claim.ts';

export interface EmployerClaimPageProps {
  /** GitHub's numeric id of the repository, from the address. */
  readonly githubRepoId: number;
}

/**
 * The page at `/corporate/claim/:githubRepoId` (E21-S04), for a signed-in person: the claim of an employee on a page of its own, for a link a
 * contributor is given. A repository that does not offer the claim is told so in one line, whatever the reason, so the page teaches nothing about
 * which tenants have an agreement. The entry itself is {@link EmployerClaim}, which the page where a contributor signs embeds.
 */
export function EmployerClaimPage({ githubRepoId }: EmployerClaimPageProps) {
  const t = useT();
  const availability = useAvailability(githubRepoId);
  return (
    <div className="flex flex-col items-start gap-4">
      <Heading level={1}>{t('corporate.claim.pageTitle')}</Heading>
      <QueryBoundary query={availability}>
        {({ corporateAvailable }) =>
          corporateAvailable ? <EmployerClaim githubRepoId={githubRepoId} /> : <p>{t('corporate.claim.unavailable')}</p>
        }
      </QueryBoundary>
    </div>
  );
}
