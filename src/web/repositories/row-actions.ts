// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { InstallationRole } from '../../shared/installations.ts';
import type { RepositoryOutcome } from './use-repository-change.ts';

/** What the rows of the table need to offer the actions on a repository. */
export interface RowActions {
  /** `installations.id` of the tenant in the address: every request is addressed through the repository of the row, and the lists that a change makes out of date are the ones of this installation. */
  readonly installationId: number;
  /** The role in the installation, for the links to the editor. */
  readonly role: InstallationRole | undefined;
  /** The installation is suspended: nothing here writes. */
  readonly suspended: boolean;
  /** Told how a change ended, once the lists have been asked for again. */
  readonly onOutcome: (outcome: RepositoryOutcome) => void;
  /** The row is gone from the list after a change (the list is filtered by a state it no longer has, or the repository is gone): the screen puts focus somewhere. */
  readonly onVanished: () => void;
}
