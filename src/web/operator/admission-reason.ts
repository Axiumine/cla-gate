// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { PlainMessageKey } from '../i18n/index.ts';
import type { OperatorInstallation } from './operator-queries.ts';

/**
 * The catalog key of the sentence for the stored reason of a rejection, or the one that says none is stored. One `switch` with no
 * default branch and a return type that cannot be `undefined`, so a reason added to the contract fails `tsc` until it has words.
 */
export function admissionReasonKey(reason: OperatorInstallation['admissionReason']): PlainMessageKey {
  switch (reason) {
    case 'account_not_allowed':
      return 'operator.admission.reason.account_not_allowed';
    case 'policy_changed':
      return 'operator.admission.reason.policy_changed';
    case null:
      return 'operator.admission.reason.none';
  }
}
