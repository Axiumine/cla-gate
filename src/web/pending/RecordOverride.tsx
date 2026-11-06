// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useState } from 'react';
import { useT } from '../i18n/index.ts';
import { Button, Dialog } from '../ui/index.ts';
import { useVanished } from '../ui/use-vanished.ts';
import { visibleText } from '../ui/user-text.ts';
import { OverrideForm } from './OverrideForm.tsx';
import { shortSha } from './short-sha.ts';

/** What the rows of the pending list need to offer the recording of an override. */
export interface RecordActions {
  /** `installations.id` of the tenant in the address: the lists that the record makes out of date are the ones of this installation. */
  readonly installationId: number;
  /** The installation is suspended: nothing here writes. */
  readonly suspended: boolean;
  /** Told once the override is stored and the list has been asked for again. */
  readonly onRecorded: () => void;
  /** The row is gone from the list after a record (the pull request passed already): the screen puts focus somewhere. */
  readonly onVanished: () => void;
}

export interface RecordOverrideProps {
  readonly actions: RecordActions;
  /** The repository of the pull request: its id addresses the request, its name is shown. */
  readonly repository: { readonly id: number; readonly fullName: string };
  /** The commit with the identity GitHub cannot link, as the pending list names it. */
  readonly commitSha: string;
}

/**
 * "Record override" on one `unlinked_identity` reason (E18-S08): a dialog that holds the form, which exists only while the dialog is
 * open, so a closed dialog starts empty the next time. The dialog closes only when the server has stored the override, and focus
 * returns to the button. A row that leaves the list after the record (the pull request passed already) takes the button with it, and
 * `onVanished` runs so the screen can put focus somewhere. The name of the button holds the commit and the repository, so the buttons of a list are told apart.
 */
export function RecordOverride({ actions, repository, commitSha }: RecordOverrideProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const settle = useVanished(actions.onVanished);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={t('pending.override.title')}
      description={t('pending.override.description')}
      trigger={
        <Button
          variant="secondary"
          disabled={actions.suspended}
          aria-label={t('pending.override.label', {
            commit: shortSha(commitSha),
            repository: visibleText(repository.fullName),
          })}
        >
          {t('pending.override')}
        </Button>
      }
    >
      <OverrideForm
        installationId={actions.installationId}
        repositoryId={repository.id}
        repositoryName={repository.fullName}
        commitSha={commitSha}
        onRecorded={() => {
          settle();
          setOpen(false);
          actions.onRecorded();
        }}
      />
    </Dialog>
  );
}
