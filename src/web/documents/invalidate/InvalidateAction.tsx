// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../../i18n/index.ts';
import { AlertDialog, Button, UserText } from '../../ui/index.ts';
import type { DocumentIds } from '../document-queries.ts';
import { InvalidateFailure } from './InvalidateFailure.tsx';
import { InvalidateFields } from './InvalidateFields.tsx';
import { InvalidatePreview } from './InvalidatePreview.tsx';
import { useInvalidateDialog } from './use-invalidate-dialog.ts';

export interface InvalidateActionProps {
  readonly ids: DocumentIds;
  /** The major whose signatures are taken out of force. */
  readonly major: number;
  /** The name of the document: text a person controls, so it goes through `UserText`. */
  readonly documentName: string;
  /** The installation is suspended: nothing here writes. */
  readonly suspended: boolean;
  /** Told how many signatures were invalidated, once the lists have been asked for again. */
  readonly onDone: (invalidated: number) => void;
}

/**
 * "Invalidate signatures of version N" (E18-S14): an `AlertDialog` that names the major and the document (through `UserText`), shows the
 * counts of the preview the server made when it opened, and asks for a reason and for the acknowledgement of the count before it sends
 * `{ major, reasonCode, expectedCount }`. It says that the invalidation applies to pull requests checked from now on and cannot be undone.
 * The dialog stays open while the request is out and when it fails, and closes when the lists have been asked for again. Focus starts on
 * Cancel, Escape cancels (it does nothing while the request is out), and focus returns to the button that opened it. The preview belongs to the document of the installation
 * in the address and is dropped when the dialog closes.
 */
export function InvalidateAction({ ids, major, documentName, suspended, onDone }: InvalidateActionProps) {
  const t = useT();
  const dialog = useInvalidateDialog({ ids, major, onDone });
  return (
    <AlertDialog
      open={dialog.open}
      onOpenChange={dialog.onOpenChange}
      title={
        <>
          {t('invalidate.title', { major })} <UserText>{documentName}</UserText>
        </>
      }
      description={t('invalidate.description')}
      confirmLabel={t('invalidate.confirm')}
      destructive
      escapeCancels
      confirming={dialog.pending}
      confirmDisabled={dialog.confirmDisabled}
      onConfirm={dialog.confirm}
      trigger={
        <Button variant="secondary" disabled={suspended} aria-label={t('invalidate.action.label', { major })}>
          {t('invalidate.action')}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <InvalidatePreview major={major} preview={dialog.preview} />
        {dialog.asked === undefined ? null : <InvalidateFields form={dialog.form} major={major} count={dialog.asked} />}
        <InvalidateFailure
          major={major}
          countChanged={dialog.countChanged}
          nothing={dialog.nothing}
          failure={dialog.failure}
        />
      </div>
    </AlertDialog>
  );
}
