// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../auth/hooks.ts';
import { useDropQueryWhenClosed } from '../../ui/use-drop-query-when-closed.ts';
import { useHeldDialog } from '../../ui/use-held-dialog.ts';
import { invalidationPreviewKey, invalidationPreviewQueryOptions } from './invalidate-queries.ts';
import { useInvalidateForm } from './use-invalidate-form.ts';
import { type InvalidationInput, useInvalidation } from './use-invalidation.ts';

/** What the question needs from the screen: the document, the major, and to be told how many signatures were invalidated. */
export type InvalidateDialogInput = Omit<InvalidationInput, 'onCountChanged'>;

/**
 * What the invalidation question of one major holds and does (E18-S14). The question is controlled, because it stays open while the
 * request is out and when it fails: the confirm button of an `AlertDialog` also asks to close it, and the held dialog is how that one
 * request is refused. Opening it asks for the count (the query is off while it is closed) and forgets what an earlier attempt left. The
 * confirm button works once the count is there and is above zero; pressing it without a reason or without the acknowledgement of the
 * count sends nothing and marks what is missing. When the server says the count moved (`count_changed`), the preview is read again
 * and the acknowledgement is withdrawn, so the new number needs a confirmation of its own. The question closes when the lists have
 * been asked for again, and the count it showed is dropped from the cache when it closes.
 */
export function useInvalidateDialog({ ids, major, onDone }: InvalidateDialogInput) {
  const client = useApiClient();
  const dialog = useHeldDialog();
  const form = useInvalidateForm();
  const preview = useQuery({ ...invalidationPreviewQueryOptions(client, ids, major), enabled: dialog.open });
  useDropQueryWhenClosed(dialog.open, invalidationPreviewKey(ids, major));
  const invalidation = useInvalidation({
    ids,
    major,
    onDone: (invalidated) => {
      dialog.close();
      onDone(invalidated);
    },
    onCountChanged: form.withdraw,
  });
  const count = preview.isFetching ? undefined : preview.data?.activeSignatures;
  /** The number the person is asked to acknowledge: none while the preview is on its way or has failed, and none when nothing is in force. */
  const asked = count === 0 ? undefined : count;
  return {
    open: dialog.open,
    onOpenChange: (next: boolean) => {
      if (next) {
        invalidation.reset();
        form.clear();
      }
      dialog.onOpenChange(next, invalidation.pending);
    },
    preview,
    asked,
    confirmDisabled: asked === undefined || invalidation.nothing,
    form: form.fields,
    confirm: () => {
      dialog.hold();
      const reasonCode = form.fields.reason;
      if (reasonCode === '' || !form.fields.acknowledged || asked === undefined) {
        form.attempt();
      } else {
        invalidation.send({ reasonCode, expectedCount: asked });
      }
    },
    pending: invalidation.pending,
    countChanged: invalidation.countChanged,
    nothing: invalidation.nothing,
    failure: invalidation.failure,
  };
}
