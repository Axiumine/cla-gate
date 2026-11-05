// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Button, DialogClose } from '../ui/index.ts';
import { FOOTER_CLASSES } from '../ui/overlay.tsx';
import { PublishFailure } from './PublishFailure.tsx';

export interface SaveFirstProps {
  /** The save is under way. */
  readonly saving: boolean;
  /** Why the save failed, if it did. */
  readonly error: unknown;
  readonly onSave: () => void;
}

/**
 * What the publish dialog shows while the text on screen is not the saved draft (E18-S05): a version is made from the saved draft,
 * so the dialog asks to save first and offers the save. When it succeeds the dialog turns into the publish form.
 */
export function SaveFirst({ saving, error, onSave }: SaveFirstProps) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <p>{t('publish.saveFirst')}</p>
      {error === undefined ? null : <PublishFailure error={error} />}
      <div className={FOOTER_CLASSES}>
        <DialogClose>
          <Button variant="secondary">{t('common.cancel')}</Button>
        </DialogClose>
        <Button variant="primary" loading={saving} onClick={onSave}>
          {t('editor.save')}
        </Button>
      </div>
    </div>
  );
}
