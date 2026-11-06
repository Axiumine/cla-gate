// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Button, DialogClose, Field, Textarea, TextInput } from '../ui/index.ts';
import { FOOTER_CLASSES } from '../ui/overlay.tsx';
import { visibleText } from '../ui/user-text.ts';
import { OverrideFailure } from './OverrideFailure.tsx';
import { type RecordOverrideInput, useRecordOverride } from './use-record-override.ts';

export interface OverrideFormProps extends RecordOverrideInput {
  /** The repository's name, as the list shows it: text a person controls, shown in a read-only field. */
  readonly repositoryName: string;
}

/**
 * The form of the override dialog (E18-S08): the repository and the commit, read-only and filled in from the pending list, and the
 * reason, which is required. The repository field shows the name with its hidden characters written out (a read-only field is no
 * `UserText`), and the request is addressed by the repository's id and never by that text. A rule the server refuses the record with
 * is shown where the person was typing or above the buttons; the typed reason stays.
 */
export function OverrideForm({ repositoryName, ...input }: OverrideFormProps) {
  const t = useT();
  const form = useRecordOverride(input);
  return (
    <form onSubmit={form.submit} noValidate className="flex flex-col gap-4">
      <Field label={t('pending.override.repository')}>
        <TextInput readOnly value={visibleText(repositoryName)} />
      </Field>
      <Field
        label={t('pending.override.commit')}
        description={t('pending.override.commit.help')}
        error={form.commitInvalid ? t('pending.override.sha.invalid') : undefined}
      >
        <TextInput readOnly value={input.commitSha} className="font-mono" />
      </Field>
      <Field
        label={t('pending.override.reason')}
        description={t('pending.override.reason.help')}
        required
        error={form.reasonInvalid ? t('pending.override.reason.invalid') : undefined}
      >
        <Textarea
          value={form.reason}
          rows={4}
          onChange={(event) => {
            form.changeReason(event.target.value);
          }}
        />
      </Field>
      <OverrideFailure error={form.failure} retry={form.sendValues} retrying={form.pending} />
      <div className={FOOTER_CLASSES}>
        <DialogClose>
          <Button variant="secondary">{t('common.cancel')}</Button>
        </DialogClose>
        <Button type="submit" variant="primary" loading={form.pending}>
          {t('pending.override.submit')}
        </Button>
      </div>
    </form>
  );
}
