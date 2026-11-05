// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Checkbox, Field } from '../ui/index.ts';

export interface ResignConfirmationProps {
  /** How many signatures of the current major version the new one makes outdated (`details.affectedSignatures`). */
  readonly count: number;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}

/**
 * What a major publish asks first when people have signed the current major version (E18-S05, `409 resign_confirmation_required`):
 * how many, and a checkbox that says the person knows they must sign again. Publishing stays off until it is checked. It is an alert,
 * so a screen reader announces it when the server's answer brings it in.
 */
export function ResignConfirmation({ count, checked, onChange }: ResignConfirmationProps) {
  const t = useT();
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-md border border-transparent bg-warning-bg px-3 py-2 text-warning-fg"
    >
      <p className="font-semibold">{t('publish.resign.title')}</p>
      <p>{t.plural('publish.resign.message', count)}</p>
      <Field label={t('publish.resign.confirm')} inline required>
        <Checkbox checked={checked} onCheckedChange={onChange} />
      </Field>
    </div>
  );
}
