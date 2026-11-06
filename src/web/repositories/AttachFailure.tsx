// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { InstallationRole } from '../../shared/installations.ts';
import type { DocumentChoice } from './document-choices.ts';
import { EditorLink } from './EditorLink.tsx';
import { editorTargetOf } from './editor-target.ts';
import { RepositoryFailure } from './RepositoryFailure.tsx';

export interface AttachFailureProps {
  /** `installations.id` of the tenant in the address. */
  readonly installationId: number;
  /** Why the attach failed. */
  readonly error: unknown;
  /** The document the person has chosen, if it is one: the refusal `document_unpublished` is about it. */
  readonly chosen: DocumentChoice | undefined;
  readonly role: InstallationRole | undefined;
  /** Sends the same request again. */
  readonly retry: () => void;
  /** The request is being sent: the retry is busy. */
  readonly retrying: boolean;
}

/** A failed attach or detach (E18-S10), told in the dialog; `document_unpublished` comes with the link to the editor of the chosen document. */
export function AttachFailure({ installationId, error, chosen, role, retry, retrying }: AttachFailureProps) {
  return (
    <RepositoryFailure
      error={error}
      retry={retry}
      retrying={retrying}
      fix={(rule) =>
        rule === 'document_unpublished' ? (
          <EditorLink installationId={installationId} target={editorTargetOf(chosen, role)} />
        ) : null
      }
    />
  );
}
