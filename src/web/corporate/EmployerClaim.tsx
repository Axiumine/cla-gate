// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Heading } from '../ui/Heading.tsx';
import { EmployerClaimForm } from './EmployerClaimForm.tsx';
import { useAvailability } from './use-claim.ts';

export interface EmployerClaimProps {
  /** GitHub's numeric id of the repository the person contributes to. */
  readonly githubRepoId: number;
}

/**
 * The entry "Contributing for an employer?" (E21-S04), for the page where a contributor signs: it is there only when the repository offers the
 * claim (`corporateAvailable` is true), and nothing at all while that is not known, when it is false and when asking failed, so a repository
 * with no corporate agreement shows no trace of it. Embedded in a page that has its own heading.
 */
export function EmployerClaim({ githubRepoId }: EmployerClaimProps) {
  const t = useT();
  const availability = useAvailability(githubRepoId);
  if (availability.data?.corporateAvailable !== true) {
    return null;
  }
  return (
    <section className="flex flex-col items-start gap-3">
      <Heading level={2}>{t('corporate.claim.title')}</Heading>
      <p className="text-fg-muted">{t('corporate.claim.intro')}</p>
      <EmployerClaimForm githubRepoId={githubRepoId} />
    </section>
  );
}
