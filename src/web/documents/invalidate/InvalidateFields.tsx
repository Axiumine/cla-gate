// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../../i18n/index.ts';
import { RevokeReasonField } from '../../signatures/RevokeReasonField.tsx';
import type { RevokeReason } from '../../signatures/use-revoke-signature.ts';
import { Checkbox, Field } from '../../ui/index.ts';

export interface InvalidateFormState {
  readonly reason: RevokeReason | '';
  readonly onReason: (reason: RevokeReason | '') => void;
  readonly acknowledged: boolean;
  readonly onAcknowledge: (acknowledged: boolean) => void;
  /** The person confirmed with no reason: the field says it is needed. */
  readonly reasonMissing: boolean;
  /** The person confirmed without acknowledging the count: the field says it is needed. */
  readonly acknowledgementMissing: boolean;
}

export interface InvalidateFieldsProps {
  readonly form: InvalidateFormState;
  /** The major being invalidated. */
  readonly major: number;
  /** The number of signatures in force that the person is asked to have seen: the one of the preview on screen. */
  readonly count: number;
}

/**
 * The two things an invalidation asks for before it goes ahead (E18-S14): the reason, one of the fixed codes of a revocation (the field
 * of the revoke question, E18-S07), and a checkbox that says the person has seen how many signatures this takes out of force. Both are
 * required, and neither has a free-text field next to it.
 */
export function InvalidateFields({ form, major, count }: InvalidateFieldsProps) {
  const t = useT();
  return (
    <>
      <RevokeReasonField value={form.reason} onChange={form.onReason} missing={form.reasonMissing} />
      <Field
        label={t.plural('invalidate.acknowledge', count, { major })}
        inline
        required
        error={form.acknowledgementMissing ? t('invalidate.acknowledge.required') : undefined}
      >
        <Checkbox checked={form.acknowledged} onCheckedChange={form.onAcknowledge} />
      </Field>
    </>
  );
}
