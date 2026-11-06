// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { QueryClient } from '@tanstack/react-query';
import { expect, test } from 'vitest';
import { REPOSITORY_DOCUMENTS_PATH } from '../../shared/cla.ts';
import { answer, testClient } from '../api/test-support.ts';
import { repositoryDocumentsQueryOptions } from './repository-documents-query.ts';
import { documentsOf } from './test-support.ts';

// E18-S10: the query of the documents a repository may enforce. Its key starts with the installation, like every query of a tenant.

test('the documents of a repository are under the installation and the repository, are asked for every time and are dropped when the dialog closes', async () => {
  const seen = answer(REPOSITORY_DOCUMENTS_PATH, documentsOf());
  const { client } = testClient();
  const options = repositoryDocumentsQueryOptions(client, 5, 1);
  expect(options.queryKey).toEqual(['installation', 5, 'repository-documents', 1]);
  expect(repositoryDocumentsQueryOptions(client, 6, 1).queryKey).not.toEqual(options.queryKey);
  expect(repositoryDocumentsQueryOptions(client, 5, 2).queryKey).not.toEqual(options.queryKey);
  expect(options.staleTime).toBe(0);
  expect(options.gcTime).toBe(0);
  await new QueryClient().query(options);
  expect(new URL(String(seen[0]?.url)).pathname).toBe('/api/installations/5/repositories/1/documents');
});
