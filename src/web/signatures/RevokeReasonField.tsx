// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { revokeReasonSchema } from '../../shared/signature-revoke.ts';
import { useT } from '../i18n/index.ts';
import { Field, Select, type SelectOption } from '../ui/index.ts';
import type { RevokeReason } from './use-revoke-signature.ts';

export interface RevokeReasonFieldProps {
  /** The reason chosen, or the empty text while none is. */
  readonly value: RevokeReason | '';
  readonly onChange: (reason: RevokeReason | '') => void;
  /** The person confirmed with no reason: the field says it is needed. */
  readonly missing: boolean;
}

/**
 * The required choice of the reason of a revocation (E18-S07): the four codes of the database check, in the words of the catalog. The
 * database stores the code and nothing else, so there is no free-text field next to it.
 */
export function RevokeReasonField({ value, onChange, missing }: RevokeReasonFieldProps) {
  const t = useT();
  const options: readonly SelectOption[] = [
    { value: '', label: t('signatures.revoke.reason.choose') },
    ...revokeReasonSchema.options.map((code) => ({ value: code, label: t(`signatures.revoke.reason.${code}`) })),
  ];
  return (
    <Field
      label={t('signatures.revoke.reason')}
      description={t('signatures.revoke.reason.help')}
      required
      error={missing ? t('signatures.revoke.reason.required') : undefined}
    >
      <Select
        options={options}
        value={value}
        onChange={(event) => {
          const chosen = revokeReasonSchema.safeParse(event.target.value);
          onChange(chosen.success ? chosen.data : '');
        }}
      />
    </Field>
  );
}
