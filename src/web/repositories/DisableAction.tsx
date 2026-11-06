// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { AlertDialog, Button, UserText } from '../ui/index.ts';
import { visibleText } from '../ui/user-text.ts';
import { RepositoryFailure } from './RepositoryFailure.tsx';
import type { Repository } from './repository-queries.ts';
import { useDisableDialog } from './use-disable-dialog.ts';
import type { RepositoryOutcome } from './use-repository-change.ts';

export interface DisableActionProps {
  /** `installations.id` of the tenant in the address. */
  readonly installationId: number;
  readonly repository: Repository;
  /** The installation is suspended: nothing here writes. */
  readonly suspended: boolean;
  /** Told how the change ended, once the lists have been asked for again. */
  readonly onOutcome: (outcome: RepositoryOutcome) => void;
}

/**
 * "Disable" on an enforcing repository (E18-S10): an `AlertDialog` that says what turning the check off does (new `license/cla` checks
 * stop, open pull requests get a neutral result, existing results and history stay) and sends the request only when the person
 * confirms. The dialog stays open while the request is out and when it fails (a `403`, GitHub down, a suspended installation are shown
 * in it, with "Try again" where it can help), and closes when the lists have been asked for again. Focus starts on Cancel and Escape does nothing.
 */
export function DisableAction({ installationId, repository, suspended, onOutcome }: DisableActionProps) {
  const t = useT();
  const { open, change, disable, onOpenChange, confirm } = useDisableDialog({
    installationId,
    repository: { id: repository.id, fullName: repository.fullName },
    onOutcome,
  });
  return (
    <AlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        <>
          {t('repositories.disable.title')} <UserText>{repository.fullName}</UserText>
        </>
      }
      description={t('repositories.disable.description')}
      confirmLabel={t('repositories.disable.confirm')}
      destructive
      confirming={change.pending}
      onConfirm={confirm}
      trigger={
        <Button
          variant="secondary"
          disabled={suspended}
          aria-label={t('repositories.disable.label', { repository: visibleText(repository.fullName) })}
        >
          {t('repositories.disable')}
        </Button>
      }
    >
      {change.failure === undefined ? null : (
        <RepositoryFailure error={change.failure} retry={disable} retrying={change.pending} />
      )}
    </AlertDialog>
  );
}
