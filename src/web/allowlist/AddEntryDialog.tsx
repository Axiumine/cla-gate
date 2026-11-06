// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useState } from 'react';
import { useT } from '../i18n/index.ts';
import { Button, Dialog } from '../ui/index.ts';
import { AddEntryForm } from './AddEntryForm.tsx';
import type { OrgMembersAvailability } from './KindField.tsx';

export interface AddEntryDialogProps {
  readonly installationId: number;
  /** The repository the entry is for, or `undefined` for the whole installation. */
  readonly repositoryId: number | undefined;
  readonly orgMembers: OrgMembersAvailability;
  /** The installation is suspended on GitHub: the screens only read, so the button is off. */
  readonly suspended: boolean;
  /** The entry was stored; the dialog has closed. */
  readonly onAdded: () => void;
}

/**
 * "Add entry" (E18-S06): a button that opens the dialog that exempts an account, in the scope of the screen. The form is inside the
 * dialog's content, which exists only while it is open, so a closed dialog starts empty the next time; it closes itself once the server
 * has stored the entry, and focus returns to the button.
 */
export function AddEntryDialog({ installationId, repositoryId, orgMembers, suspended, onAdded }: AddEntryDialogProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={t('allowlist.add.title')}
      description={t('allowlist.add.description')}
      trigger={
        <Button variant="primary" disabled={suspended}>
          {t('allowlist.add')}
        </Button>
      }
    >
      <AddEntryForm
        installationId={installationId}
        repositoryId={repositoryId}
        orgMembers={orgMembers}
        onAdded={() => {
          setOpen(false);
          onAdded();
        }}
      />
    </Dialog>
  );
}
