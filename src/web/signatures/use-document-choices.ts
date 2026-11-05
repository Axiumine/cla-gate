// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQuery } from '@tanstack/react-query';
import type { InstallationRole } from '../../shared/installations.ts';
import { useApiClient } from '../auth/hooks.ts';
import { documentsQueryOptions, scopeRepositoriesQueryOptions } from '../documents/document-queries.ts';
import type { DocumentScope } from './signature-permissions.ts';

// The documents a person can narrow the signatures to (E18-S07).

/** A document to choose in the filter: its id, its name (text a person controls) and where it applies. */
export interface DocumentChoice {
  readonly id: number;
  readonly name: string;
  readonly scope: DocumentScope;
  /** The repository of a repository-scoped document, `null` for one of the whole installation. */
  readonly repository: string | null;
}

/**
 * The documents of the installation for the filter and the export. An org admin lists every document of the installation
 * (`GET .../documents`, which is for org admins only). A repo admin has no such list, so their documents are the ones of the
 * repositories they administer that carry a repository-scoped document (`GET .../repositories`, the document each one
 * enforces): every repository-scoped document a repo admin may read the signatures of is attached to its repository. A person whose role
 * is not known yet asks for neither. A list that cannot be read leaves the choices empty and says nothing of its own: the search
 * itself reports what failed, and the filter still works for a document named in the address.
 */
export function useDocumentChoices(
  installationId: number,
  role: InstallationRole | undefined,
): readonly DocumentChoice[] {
  const client = useApiClient();
  const documents = useQuery({ ...documentsQueryOptions(client, installationId), enabled: role === 'org_admin' });
  const repositories = useQuery({
    ...scopeRepositoriesQueryOptions(client, installationId),
    enabled: role === 'repo_admin',
  });
  const listed: readonly DocumentChoice[] = (documents.data?.documents ?? []).map((document) => ({
    id: document.id,
    name: document.name,
    scope: document.scope,
    repository: document.repositoryFullName,
  }));
  const attached: readonly DocumentChoice[] = (repositories.data?.items ?? []).flatMap((repository) =>
    repository.canAdminister && repository.document?.scope === 'repository'
      ? [
          {
            id: repository.document.id,
            name: repository.document.name,
            scope: 'repository' as const,
            repository: repository.fullName,
          },
        ]
      : [],
  );
  return role === 'repo_admin' ? attached : listed;
}
