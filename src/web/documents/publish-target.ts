// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { PublishSource } from '../../shared/cla-version.ts';
import type { ActiveVersion } from './editor-state.ts';

// What a publish is made from and what that settles about its kind of change (E18-S05, E18-S11): the saved draft (the publish dialog
// of the editor), or a version the document already has (a restore from the history, E12-S06).

/** Where the text of the new version comes from, with what the screen needs to know about it: the draft's revision, or the version and its major. */
export type PublishFrom =
  | { readonly type: 'draft'; readonly revision: number }
  | { readonly type: 'version'; readonly versionId: number; readonly major: number };

export interface PublishTarget {
  readonly from: PublishFrom;
  /** The version the person saw as the active one, or `null` when the document has none. */
  readonly active: ActiveVersion | null;
}

/** Why the kind of change is not a choice: the first version of a document, and a copy of a version of another major than the active one. */
export type ForcedMajor = 'first' | 'rollback';

/**
 * Why `major` is the only kind of change, or `undefined` when `minor` is a choice. A document with no version can only be published as a
 * major one (`first_version_must_be_major`). A copy of a version of another major than the active one would change the terms of
 * everyone who signed the current major without asking them again, so it is a major one (`422 rollback_requires_major`, E12-S06). The
 * server decides all the same; this is what the form shows first.
 */
export function forcedMajorOf({ from, active }: PublishTarget): ForcedMajor | undefined {
  if (active === null) {
    return 'first';
  }
  return from.type === 'version' && from.major !== active.major ? 'rollback' : undefined;
}

/** The `source` of the request body for `from`: the screen's extra knowledge (the major) is never sent. */
export function sourceOf(from: PublishFrom): PublishSource {
  return from.type === 'draft'
    ? { type: 'draft', revision: from.revision }
    : { type: 'version', versionId: from.versionId };
}
