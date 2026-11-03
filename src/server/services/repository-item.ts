// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Role } from '../domain/authz.ts';
import { requiredRoleForRepository, satisfiesRole, scopeOfAttached } from '../domain/repository-action.ts';
import type { ListedDocument, RepositoryEntry } from './repository-entry.ts';

// One repository of the list as the API tells it (`repositoryItemSchema`, E14-S01): the stored entry and the viewer's role
// turned into what the viewer may do with it, by the repository-action rule.

/** One repository of the page, as the API tells it. */
export interface ListedRepository {
  readonly id: number;
  readonly githubRepoId: number;
  readonly fullName: string;
  readonly enabled: boolean;
  /** The repository-action rule applied to the viewer: whether they may attach a document, enable and disable it, edit its allowlist. */
  readonly canAdminister: boolean;
  readonly document: {
    readonly id: number;
    readonly name: string;
    readonly scope: 'installation' | 'repository';
    readonly activeVersion: ListedDocument['activeVersion'];
  } | null;
}

/** The entry as the API tells it, for a viewer who holds `role`. */
export function present(entry: RepositoryEntry, role: Role): ListedRepository {
  const { document } = entry;
  const required = requiredRoleForRepository(entry, scopeOfAttached(document));
  return {
    id: entry.id,
    githubRepoId: entry.githubRepoId,
    fullName: entry.fullName,
    enabled: entry.enabled,
    canAdminister: satisfiesRole(role, required),
    document:
      document === null
        ? null
        : {
            id: document.id,
            name: document.name,
            scope: document.repositoryId === null ? 'installation' : 'repository',
            activeVersion: document.activeVersion,
          },
  };
}
