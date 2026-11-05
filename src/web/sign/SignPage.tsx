// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../auth/index.ts';
import { QueryBoundary } from '../states/index.ts';
import { SignView } from './SignView.tsx';
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
 * records the consent. The state of the data (loading, failed) is the shared one; the cases of E18-S02 (no login, already
 * signed, no verified email, a text that changed) are the stories after this one.
 */
export function SignPage({ githubRepoId, pr }: SignPageProps) {
  const client = useApiClient();
  const query = useQuery(signContextQueryOptions(client, githubRepoId, pr));
  return (
    <QueryBoundary query={query}>
      {(context) => <SignView key={`${githubRepoId}:${pr ?? ''}`} context={context} />}
    </QueryBoundary>
  );
}
