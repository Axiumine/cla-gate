// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useState } from 'react';
import { useInstallation } from '../../installations/use-installations.ts';
import { canManage, type DocumentScope } from '../../signatures/signature-permissions.ts';
import type { DocumentIds } from '../document-queries.ts';

/** What the last invalidation did: the major it took out of force and how many signatures it invalidated. */
export interface InvalidationOutcome {
  readonly major: number;
  readonly invalidated: number;
}

/** What the table of versions needs to offer the invalidation of a major. */
export interface InvalidateControl {
  readonly ids: DocumentIds;
  /** The name of the document: text a person controls. */
  readonly documentName: string;
  /** The installation is suspended: nothing here writes. */
  readonly suspended: boolean;
  /** Told what an invalidation did, once the lists have been asked for again. */
  readonly onOutcome: (outcome: InvalidationOutcome) => void;
}

/** The document the history belongs to, as far as the invalidation needs it. */
export interface InvalidatedDocument {
  readonly name: string;
  readonly scope: DocumentScope;
}

/**
 * Whether the viewer is offered the invalidation of a major of this document, and what the last one did (E18-S14). The control exists
 * for the roles that may manage the document, which follows its scope (an org admin for any document, a repo admin for the documents of a
 * repository, a role not yet known for none); the server decides on every request all the same. `outcome` is what the last invalidation
 * did, for the live region of the history.
 */
export function useInvalidateControl(ids: DocumentIds, document: InvalidatedDocument) {
  const installation = useInstallation(ids.installationId);
  const [outcome, setOutcome] = useState<InvalidationOutcome | undefined>(undefined);
  const control: InvalidateControl | undefined = canManage(installation?.role, document.scope)
    ? { ids, documentName: document.name, suspended: installation?.suspended === true, onOutcome: setOutcome }
    : undefined;
  return { control, outcome };
}
