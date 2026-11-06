// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useState } from 'react';
import type { RevokeOutcome } from './use-revoke-signature.ts';

/**
 * What the last change on the signatures screen said (E18-S07, E18-S14): what a revocation came to, or how many rows of personal data an
 * erasure removed. The live region tells one of them at a time, so the one that happens replaces the one before.
 */
export function useResultNotices() {
  const [notice, setNotice] = useState<RevokeOutcome | undefined>(undefined);
  const [erased, setErased] = useState<number | undefined>(undefined);
  return {
    notice,
    erased,
    onRevoked: (outcome: RevokeOutcome) => {
      setNotice(outcome);
      setErased(undefined);
    },
    onErased: (rows: number) => {
      setErased(rows);
      setNotice(undefined);
    },
  };
}
