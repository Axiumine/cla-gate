// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../auth/hooks.ts';
import { useDropQueryWhenClosed } from '../../ui/use-drop-query-when-closed.ts';
import { useHeldDialog } from '../../ui/use-held-dialog.ts';
import { erasurePreviewKey, erasurePreviewQueryOptions } from './erase-queries.ts';
import { isNothingHeld } from './erase-rules.ts';
import { type ErasureInput, useErase } from './use-erase.ts';

export interface EraseDialogInput extends ErasureInput {
  /** The personal data of the person is erased already: the question does not open. */
  readonly erased: boolean;
}

/**
 * What the erasure question of one person holds and does (E18-S14). The question is controlled, because it stays open while the request
 * is out and when it fails: the confirm button of an `AlertDialog` also asks to close it, and the held dialog is how that one request
 * is refused. Opening it asks for the counts (the query is off while it is closed) and forgets what an earlier attempt left. The confirm
 * button works once the counts are there and the installation holds something of the person; it sends the number of rows the person
 * saw. When the server says that number moved (`count_changed`) the preview is read again, and the new numbers need a confirmation of
 * their own. The question closes when the signatures have been asked for again, and the counts it showed are dropped from the cache when it closes.
 */
export function useEraseDialog({ erased, ...input }: EraseDialogInput) {
  const { installationId, githubUserId, onDone } = input;
  const client = useApiClient();
  const dialog = useHeldDialog();
  const preview = useQuery({
    ...erasurePreviewQueryOptions(client, installationId, githubUserId),
    enabled: dialog.open,
  });
  const erasure = useErase({
    installationId,
    githubUserId,
    onDone: (erasedRows) => {
      dialog.close();
      onDone(erasedRows);
    },
  });
  useDropQueryWhenClosed(dialog.open, erasurePreviewKey(installationId, githubUserId));
  const rows = preview.isFetching ? undefined : preview.data?.signerPiiRows;
  /** Sends the erasure held to the rows the person saw; there is none to send while the counts are not there, and then the button is off. */
  const send =
    rows === undefined
      ? undefined
      : () => {
          erasure.send(rows);
        };
  return {
    open: dialog.open,
    onOpenChange: (next: boolean) => {
      if (next && erased) {
        return;
      }
      if (next) {
        erasure.reset();
      }
      dialog.onOpenChange(next, erasure.pending);
    },
    preview,
    nothingHeld: isNothingHeld(preview.error) || erasure.nothingHeld,
    confirmDisabled: rows === undefined || erasure.nothingHeld,
    confirm: () => {
      dialog.hold();
      send?.();
    },
    pending: erasure.pending,
    countChanged: erasure.countChanged,
    failure: erasure.failure,
  };
}
