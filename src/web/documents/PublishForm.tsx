// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Dispatch } from 'react';
import { useT } from '../i18n/index.ts';
import { Button, DialogClose } from '../ui/index.ts';
import { FOOTER_CLASSES } from '../ui/overlay.tsx';
import type { DocumentIds } from './document-queries.ts';
import type { EditorAction, EditorState } from './editor-state.ts';
import { PublishFailure } from './PublishFailure.tsx';
import { PublishFields } from './PublishFields.tsx';
import { PublishPreview } from './PublishPreview.tsx';
import { ResignConfirmation } from './ResignConfirmation.tsx';
import { usePublish } from './use-publish.ts';
import { nextVersion } from './version-number.ts';

export interface PublishFormProps {
  readonly ids: DocumentIds;
  readonly state: EditorState;
  /** The revision of the saved draft the version is made from: the text on screen is that draft. */
  readonly revision: number;
  readonly dispatch: Dispatch<EditorAction>;
}

/**
 * The publish form (E18-S05), shown when the text on screen is the saved draft: the kind of change, the rationale, the number the
 * version would get and the hash of the text, the statement that a published version is immutable, and, when the server asks, the
 * confirmation that signers must sign again. The button is busy while the request is under way and a second click sends nothing.
 */
export function PublishForm({ ids, state, revision, dispatch }: PublishFormProps) {
  const t = useT();
  const publish = usePublish(ids, revision, state, dispatch);
  return (
    <form onSubmit={publish.submit} noValidate className="flex flex-col gap-4">
      <PublishFields
        bump={publish.bump}
        hasActive={state.active !== null}
        rationale={publish.rationale}
        rationaleInvalid={publish.rationaleInvalid}
        onBump={publish.setBump}
        onRationale={publish.changeRationale}
      />
      <PublishPreview version={nextVersion(state.active, publish.bump)} text={state.saved.text} />
      <p className="text-sm text-fg-muted">{t('publish.immutable')}</p>
      {publish.affected === undefined ? null : (
        <ResignConfirmation
          count={publish.affected}
          checked={publish.acknowledged}
          onChange={publish.setAcknowledged}
        />
      )}
      {publish.failure === undefined ? null : <PublishFailure error={publish.failure} />}
      <div className={FOOTER_CLASSES}>
        <DialogClose>
          <Button variant="secondary">{t('common.cancel')}</Button>
        </DialogClose>
        <Button type="submit" variant="primary" loading={publish.pending} disabled={publish.confirming}>
          {t('publish.submit')}
        </Button>
      </div>
    </form>
  );
}
