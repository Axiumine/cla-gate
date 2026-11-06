// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../auth/index.ts';
import { ErrorState, QueryBoundary } from '../states/index.ts';
import { LoginPrompt } from './LoginPrompt.tsx';
import { NoActiveCla } from './NoActiveCla.tsx';
import { signReturnTo } from './params.ts';
import { SignView } from './SignView.tsx';
import { isNoActiveCla, isUnauthenticated } from './sign-failures.ts';
import { signContextQueryOptions } from './sign-queries.ts';

export interface SignPageProps {
  /** The numeric GitHub repository id of the path: stable across renames and transfers. */
  readonly githubRepoId: number;
  /** The pull request the person came from (`?pr=`), when they came from one. */
  readonly pr: number | undefined;
}

/**
 * The page at `/sign/$githubRepoId` (E18-S01): the link that the pull request comment carries (E09). It asks the server for
 * the CLA in force for the repository and for what the person has signed (E13-S02) and shows the text with the form that
 * records the consent. Each way the answer can fail to be that is a state of its own (E18-S02): no login (`401`, so no text is
 * ever loaded: the page explains signing and offers the login), no CLA in force (`409 no_active_cla`, neutral, with no form),
 * and every other failure, `404` and `429` included, the error state with the request id. A `404` is the same for an unknown
 * repository, a suspended tenant and one the instance does not admit, so the page says nothing about which tenants exist.
 */
export function SignPage({ githubRepoId, pr }: SignPageProps) {
  const client = useApiClient();
  const query = useQuery(signContextQueryOptions(client, githubRepoId, pr));
  const failure = query.isError ? query.error : undefined;
  if (isNoActiveCla(failure)) {
    return <NoActiveCla replacedPage={query.data !== undefined} />;
  }
  if (query.data === undefined && failure !== undefined) {
    return isUnauthenticated(failure) ? (
      <LoginPrompt returnTo={signReturnTo(githubRepoId, pr)} />
    ) : (
      <ErrorState error={failure} level={1} refetch={query.refetch} retrying={query.isFetching} />
    );
  }
  const reload = async (): Promise<boolean> => (await query.refetch()).isSuccess;
  return (
    <QueryBoundary query={query}>
      {(context) => (
        <SignView key={`${githubRepoId}:${pr ?? ''}`} context={context} reload={reload} reloading={query.isFetching} />
      )}
    </QueryBoundary>
  );
}
