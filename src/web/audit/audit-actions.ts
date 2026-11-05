// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { AUDIT_ACTIONS, type AuditAction } from '../../shared/audit.ts';
import type { PlainMessageKey } from '../i18n/index.ts';

// The words of an audit action (E18-S09). The catalogue of actions is closed (`AUDIT_ACTIONS`), but a row outlives the release that
// wrote it, so a code that is not in it is shown as it is and never hidden.

/**
 * The catalog key of the label of `action`. The type of the result is the template of the key, so an action added to
 * `AUDIT_ACTIONS` without its `audit.action.<action>` message fails `tsc` here.
 */
export function actionLabelKey(action: AuditAction): PlainMessageKey {
  return `audit.action.${action}`;
}

/** The action of the catalogue that `code` is, or `undefined` for a code the catalogue does not know. */
export function knownAction(code: string): AuditAction | undefined {
  return AUDIT_ACTIONS.find((action) => action === code);
}
