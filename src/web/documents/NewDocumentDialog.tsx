// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Button, Dialog } from '../ui/index.ts';
import { NewDocumentForm } from './NewDocumentForm.tsx';

export interface NewDocumentDialogProps {
  readonly installationId: number;
  /** The installation is suspended on GitHub: the screens only read, so the button is off. */
  readonly suspended: boolean;
}

/**
 * "New document" (E18-S05): a button that opens the dialog that creates a document with a name, a scope and a kind. The document
 * starts empty (no legal text is provided). The form is inside the dialog's content, which exists only while it is open, so the
 * repositories for the scope are asked for only when the person opens it, and a form that was closed starts empty the next time.
 */
export function NewDocumentDialog({ installationId, suspended }: NewDocumentDialogProps) {
  const t = useT();
  return (
    <Dialog
      title={t('documents.new.title')}
      description={t('documents.new.description')}
      trigger={
        <Button variant="primary" disabled={suspended}>
          {t('documents.new')}
        </Button>
      }
    >
      <NewDocumentForm installationId={installationId} />
    </Dialog>
  );
}
