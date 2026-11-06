// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useState } from 'react';
import type { RevokeReason } from '../../signatures/use-revoke-signature.ts';
import type { InvalidateFormState } from './InvalidateFields.tsx';

/**
 * What the person has filled in on the invalidation question (E18-S14): the reason, the acknowledgement of the count, and whether they
 * have tried to confirm yet, which is when a missing value is marked. `clear` forgets everything (the question opens), `withdraw` takes
 * back the acknowledgement and the marks (the count moved, so the new number needs a confirmation of its own, and the reason stays),
 * and `attempt` marks what is missing.
 */
export function useInvalidateForm() {
  const [reason, setReason] = useState<RevokeReason | ''>('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const fields: InvalidateFormState = {
    reason,
    onReason: setReason,
    acknowledged,
    onAcknowledge: setAcknowledged,
    reasonMissing: attempted && reason === '',
    acknowledgementMissing: attempted && !acknowledged,
  };
  return {
    fields,
    attempt: () => {
      setAttempted(true);
    },
    withdraw: () => {
      setAcknowledged(false);
      setAttempted(false);
    },
    clear: () => {
      setReason('');
      setAcknowledged(false);
      setAttempted(false);
    },
  };
}
