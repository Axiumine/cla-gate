// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { PENDING_REASON_CODES, type PendingReasonCode } from '../../shared/pending-prs.ts';
import { useT } from '../i18n/index.ts';
import { Field, Select, type SelectOption } from '../ui/index.ts';

export interface ReasonFieldProps {
  /** The reason the list is narrowed to, or `undefined` for all of them. */
  readonly value: PendingReasonCode | undefined;
  readonly onChange: (reason: PendingReasonCode | undefined) => void;
}

/** The reason a value of the select stands for, or `undefined` for "all reasons" and for anything that is not one. */
function reasonOf(value: string): PendingReasonCode | undefined {
  return PENDING_REASON_CODES.find((code) => code === value);
}

/** The select that narrows the pending list to one reason (E18-S08), with "all reasons" as the empty choice. */
export function ReasonField({ value, onChange }: ReasonFieldProps) {
  const t = useT();
  const options: readonly SelectOption[] = [
    { value: '', label: t('pending.filter.reason.all') },
    ...PENDING_REASON_CODES.map((code) => ({ value: code, label: t(`pending.reasonName.${code}`) })),
  ];
  return (
    <Field label={t('pending.filter.reason')}>
      <Select
        options={options}
        value={value ?? ''}
        onChange={(event) => {
          onChange(reasonOf(event.target.value));
        }}
      />
    </Field>
  );
}
