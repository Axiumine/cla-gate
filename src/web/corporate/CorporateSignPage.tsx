// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQuery } from '@tanstack/react-query';
import { corporateDocumentRoute } from '../../shared/corporate.ts';
import { useApiClient } from '../auth/index.ts';
import { useT } from '../i18n/index.ts';
import { QueryBoundary } from '../states/index.ts';
import { Heading } from '../ui/Heading.tsx';
import { CorporateDocumentView } from './CorporateDocumentView.tsx';
import { CorporateFailure } from './CorporateFailure.tsx';
import { corporateErrorKey } from './corporate-errors.ts';

export interface CorporateSignPageProps {
  /** GitHub's numeric id of the repository, from the address. */
  readonly githubRepoId: number;
}

/**
 * The page at `/corporate/sign/:githubRepoId` (E21-S02), for a signed-in person: the corporate CLA in force for the repository
 * and the form through which an authorised signatory signs it for a company. The text is drawn from its stored source by the
 * sanitised pipeline of E12-S07. A repository with no corporate CLA in force is told so in the words of the catalog; any other
 * failure to load it is the generic state.
 */
export function CorporateSignPage({ githubRepoId }: CorporateSignPageProps) {
  const t = useT();
  const client = useApiClient();
  const query = useQuery({
    queryKey: ['corporate', 'document', githubRepoId],
    queryFn: ({ signal }) => client.call(corporateDocumentRoute, { params: { githubRepoId } }, { signal }),
  });
  const reload = () => {
    void query.refetch();
  };
  return (
    <div className="flex flex-col items-start gap-4">
      <Heading level={1}>{t('corporate.sign.title')}</Heading>
      {query.data === undefined && corporateErrorKey(query.error) !== null ? (
        <CorporateFailure error={query.error} onReload={reload} />
      ) : (
        <QueryBoundary query={query}>
          {(document) => <CorporateDocumentView document={document} onReload={reload} />}
        </QueryBoundary>
      )}
    </div>
  );
}
