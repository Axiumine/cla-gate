// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Button, DialogClose } from '../ui/index.ts';
import { FOOTER_CLASSES } from '../ui/overlay.tsx';
import type { DocumentIds } from './document-queries.ts';
import { PublishFailure } from './PublishFailure.tsx';
import { PublishFields } from './PublishFields.tsx';
import { PublishPreview } from './PublishPreview.tsx';
import type { PublishTarget } from './publish-target.ts';
import { ResignConfirmation } from './ResignConfirmation.tsx';
import { usePublish } from './use-publish.ts';
import type { PublishOutcomes } from './use-publish-request.ts';
import { nextVersion } from './version-number.ts';

export interface PublishFormProps {
  readonly ids: DocumentIds;
  /** What the version is made from, and the version the person saw as the active one. */
  readonly target: PublishTarget;
  /** The text the version is made from, for the hash preview: the saved draft, or the text of the version restored. */
  readonly text: string;
  /** What happens with the answers of the server that are not the form's business. */
  readonly outcomes: PublishOutcomes;
}

/**
 * The publish form (E18-S05), shown when the text on screen is the saved draft, and in the dialog that restores a version (E18-S11): the kind of change, the rationale, the number the
 * version would get and the hash of the text, the statement that a published version is immutable, and, when the server asks, the
 * confirmation that signers must sign again. The button is busy while the request is under way and a second click sends nothing.
 */
export function PublishForm({ ids, target, text, outcomes }: PublishFormProps) {
  const t = useT();
  const publish = usePublish(ids, target, outcomes);
  return (
    <form onSubmit={publish.submit} noValidate className="flex flex-col gap-4">
      <PublishFields
        bump={publish.bump}
        forced={publish.forced}
        rationale={publish.rationale}
        rationaleInvalid={publish.rationaleInvalid}
        onBump={publish.setBump}
        onRationale={publish.changeRationale}
      />
      <PublishPreview version={nextVersion(target.active, publish.bump)} text={text} />
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
