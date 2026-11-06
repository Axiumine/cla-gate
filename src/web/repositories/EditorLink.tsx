// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Link } from '@tanstack/react-router';
import { useT } from '../i18n/index.ts';
import type { EditorTarget } from './editor-target.ts';

export interface EditorLinkProps {
  /** `installations.id` of the tenant in the address. */
  readonly installationId: number;
  /** Where to send the person; nothing is drawn without one. */
  readonly target: EditorTarget | undefined;
}

/** The link to the editor of a document, or to the list of documents (E18-S05), where a version can be published. */
export function EditorLink({ installationId, target }: EditorLinkProps) {
  const t = useT();
  if (target === undefined) {
    return null;
  }
  return target.kind === 'document' ? (
    <Link
      to="/installations/$installationId/documents/$documentId"
      params={{ installationId, documentId: target.documentId }}
      className="underline underline-offset-2"
    >
      {t('repositories.editor')}
    </Link>
  ) : (
    <Link
      to="/installations/$installationId/documents"
      params={{ installationId }}
      className="underline underline-offset-2"
    >
      {t('repositories.fix.documents')}
    </Link>
  );
}
