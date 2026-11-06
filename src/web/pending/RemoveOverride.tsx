// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { AlertDialog, Button } from '../ui/index.ts';
import { OverrideFailure } from './OverrideFailure.tsx';
import type { CommitOverride } from './pending-queries.ts';
import { shortSha } from './short-sha.ts';
import { useRemoveDialog } from './use-remove-dialog.ts';
import type { RemovalOutcome } from './use-remove-override.ts';

export interface RemoveOverrideProps {
  /** `installations.id` of the tenant in the address. */
  readonly installationId: number;
  /** `repositories.id` of the repository whose overrides are listed. */
  readonly repositoryId: number;
  readonly item: CommitOverride;
  /** The installation is suspended: nothing here writes. */
  readonly suspended: boolean;
  /** Told how the removal ended, once the lists have been asked for again. */
  readonly onOutcome: (outcome: RemovalOutcome) => void;
  /** The row is gone from the list after the removal: the screen puts focus somewhere. */
  readonly onVanished: () => void;
}

/**
 * "Remove" on one override (E18-S08): an `AlertDialog` that names the commit, says that the commit has to be covered again and that a
 * green check may turn red, and removes the override only when the person confirms. The dialog stays open while the request is out
 * and when it fails (a `403`, GitHub down, a suspended installation are shown in it, with "Try again" where it can help), and closes when
 * the lists have been asked for again. Focus starts on Cancel and Escape does nothing. The row leaves the list with its button, so `onVanished` puts focus on the results.
 */
export function RemoveOverride({
  installationId,
  repositoryId,
  item,
  suspended,
  onOutcome,
  onVanished,
}: RemoveOverrideProps) {
  const t = useT();
  const { open, removal, onOpenChange, confirm } = useRemoveDialog({
    installationId,
    repositoryId,
    overrideId: item.id,
    onOutcome,
    onVanished,
  });
  const commit = shortSha(item.commitSha);
  return (
    <AlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        <>
          {t('pending.overrides.remove.title')} <code>{commit}</code>
        </>
      }
      description={t('pending.overrides.remove.description')}
      confirmLabel={t('pending.overrides.remove.confirm')}
      destructive
      confirming={removal.pending}
      onConfirm={confirm}
      trigger={
        <Button variant="secondary" disabled={suspended} aria-label={t('pending.overrides.remove.label', { commit })}>
          {t('pending.overrides.remove')}
        </Button>
      }
    >
      <OverrideFailure error={removal.failure} retry={removal.remove} retrying={removal.pending} />
    </AlertDialog>
  );
}
