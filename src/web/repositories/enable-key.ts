// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Repository } from './repository-queries.ts';

/** A text that changes when the document the repository has, or the version of it in force, changes, so a refusal that said "attach a CLA" does not outlive the attaching. */
export function enableKey({ document }: Repository): string {
  return JSON.stringify(document === null ? null : [document.id, document.activeVersion]);
}
