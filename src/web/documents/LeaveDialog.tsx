// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { AlertDialog } from '../ui/index.ts';
import type { LeaveGuard } from './use-leave-guard.ts';

export interface LeaveDialogProps {
  readonly guard: LeaveGuard;
}

/**
 * The question a held navigation asks (E18-S05): leave and lose the changes that are not saved, or stay. Staying is the safe
 * answer and where focus starts; Escape and a click outside do nothing (an `AlertDialog`).
 */
export function LeaveDialog({ guard }: LeaveDialogProps) {
  const t = useT();
  if (guard.status !== 'blocked') {
    return null;
  }
  return (
    <AlertDialog
      open
      title={t('editor.leave.title')}
      description={t('editor.leave.description')}
      confirmLabel={t('editor.leave.confirm')}
      cancelLabel={t('editor.leave.stay')}
      destructive
      onConfirm={guard.proceed}
      onOpenChange={() => {
        guard.reset();
      }}
    />
  );
}
