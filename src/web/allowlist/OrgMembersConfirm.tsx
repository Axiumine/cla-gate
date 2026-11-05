// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { AlertDialog } from '../ui/index.ts';

export interface OrgMembersConfirmProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Runs when the person confirms; the question closes after it. */
  readonly onConfirm: () => void;
}

/**
 * The question that comes before an `org_members` entry (E18-S06): every current and future member of the organisation, private members
 * included, becomes exempt. Cancel is where focus starts; Escape does nothing, so the choice is always made with a button.
 */
export function OrgMembersConfirm({ open, onOpenChange, onConfirm }: OrgMembersConfirmProps) {
  const t = useT();
  return (
    <AlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('allowlist.orgMembers.title')}
      description={t('allowlist.orgMembers.description')}
      confirmLabel={t('allowlist.orgMembers.confirm')}
      destructive
      onConfirm={onConfirm}
    />
  );
}
