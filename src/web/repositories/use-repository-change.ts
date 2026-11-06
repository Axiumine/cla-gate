// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ApiClient } from '../api/index.ts';
import { useApiClient } from '../auth/hooks.ts';
import { useSingleFlight } from '../documents/use-single-flight.ts';
import { INSTALLATIONS_KEY } from '../installations/installation-queries.ts';
import { isSuspended } from '../pending/override-rules.ts';
import { repositoriesKey } from './repository-queries.ts';
import { isGone } from './repository-rules.ts';

/** What a change came to: it was made, it asked for what was already so (`changed: false`), or the repository is not the installation's any more. */
type OutcomeKind = 'attached' | 'detached' | 'enabled' | 'disabled' | 'unchanged' | 'gone';

/** How a change ended, with the repository it was about (text a person controls: drawn through `visibleText`). */
export interface RepositoryOutcome {
  readonly kind: OutcomeKind;
  readonly repository: string;
}

/** The repository a change is about: its id addresses the request, its name is shown in the notice. */
interface RepositoryRef {
  readonly id: number;
  readonly fullName: string;
}

/** Which repository a change is about, and what to do when it has ended. */
export interface RepositoryChangeTarget {
  /** `installations.id` of the tenant in the address: the lists that the change makes out of date are the ones of this installation. */
  readonly installationId: number;
  readonly repository: RepositoryRef;
  /** Told how the change ended, once the lists have been asked for again. */
  readonly onOutcome: (outcome: RepositoryOutcome) => void;
}

export interface RepositoryChangeInput<Variables, Data> extends RepositoryChangeTarget {
  /** The request, addressed through the repository the row came from. */
  readonly request: (client: ApiClient, repositoryId: number, variables: Variables) => Promise<Data>;
  /** What the answer of the server says the change came to. */
  readonly outcomeOf: (data: Data) => Exclude<OutcomeKind, 'gone'>;
}

/**
 * One change to a repository (E18-S10): sent once at a time (a double click is one request) and never optimistic, the row changes when
 * the list that is asked for again says so. A `404` (the repository is gone, or never was the installation's) asks for the lists again
 * and is the outcome `gone`: the row is removed by the refetch. A `409 installation_suspended` asks for the list of installations
 * again, whose flag then disables the actions and shows the banner of the tenant. Any other failure is `failure`, for the dialog or
 * the row to show, and leaves the lists as they are.
 */
export function useRepositoryChange<Variables, Data>({
  installationId,
  repository,
  request,
  outcomeOf,
  onOutcome,
}: RepositoryChangeInput<Variables, Data>) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: repositoriesKey(installationId) });
  const mutation = useMutation({
    gcTime: 0,
    mutationFn: (variables: Variables) => request(client, repository.id, variables),
    onSuccess: async (data) => {
      await refresh();
      onOutcome({ kind: outcomeOf(data), repository: repository.fullName });
    },
    onError: async (error) => {
      if (isGone(error)) {
        await refresh();
        onOutcome({ kind: 'gone', repository: repository.fullName });
      } else if (isSuspended(error)) {
        await queryClient.invalidateQueries({ queryKey: INSTALLATIONS_KEY });
      }
    },
  });
  return {
    send: useSingleFlight(mutation),
    reset: mutation.reset,
    pending: mutation.isPending,
    failure: mutation.isError && !isGone(mutation.error) ? mutation.error : undefined,
  };
}
