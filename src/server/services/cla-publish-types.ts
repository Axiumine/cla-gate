// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { PublishSource, VersionBump } from '../../shared/cla-version.ts';
import type { GithubId } from '../../shared/github-id.ts';
import type { StoredActiveVersion } from './cla-document-types.ts';

// The shapes of publishing a version of a CLA (E12-S04, the source of a copy E12-S06): what a publish is made of and what it answers. The checks are in
// cla-publish-checks.ts and the transaction in cla-publish.ts.

/** The person who publishes: `id` is `users.id` (stored as `published_by`), `githubId` the identity the audit row names. */
interface PublishActor {
  readonly id: number;
  readonly githubId: GithubId;
}

/** What a publish is made of, as the route reads it. The rationale is as the person typed it; `publishVersion` cleans it before anything else sees it. */
export interface VersionPublish {
  readonly actor: PublishActor;
  readonly documentId: number;
  /** The saved draft at a revision, or a version of the same document to publish again as a new one (a rollback, E12-S06). */
  readonly source: PublishSource;
  readonly bump: VersionBump;
  readonly rationale: string;
  /** The active version the person saw: null when the document had none. */
  readonly expectedActiveVersionId: number | null;
  /** True when the person confirmed that the signatures of the previous major stop counting. */
  readonly acknowledgeResigning: boolean;
}

/** What a publish did: the version, whether signers must sign again, and how many signatures of the previous major that affects. */
export interface PublishedVersion {
  readonly version: StoredActiveVersion;
  readonly requiresResigning: boolean;
  readonly affectedSignatures: number;
}
