// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { InstallationRole } from '../../shared/installations.ts';
import { useT } from '../i18n/index.ts';
import { Button, Dialog, UserText } from '../ui/index.ts';
import { visibleText } from '../ui/user-text.ts';
import { AttachForm } from './AttachForm.tsx';
import type { Repository } from './repository-queries.ts';
import { useAttachDocument } from './use-attach-document.ts';
import type { RepositoryOutcome } from './use-repository-change.ts';

export interface AttachActionProps {
  /** `installations.id` of the tenant in the address. */
  readonly installationId: number;
  readonly repository: Repository;
  readonly role: InstallationRole | undefined;
  /** The installation is suspended: nothing here writes. */
  readonly suspended: boolean;
  /** Controlled, because the "Attach a CLA" of a refused enable opens this dialog too. */
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Told how the change ended, once the lists have been asked for again. */
  readonly onOutcome: (outcome: RepositoryOutcome) => void;
}

/**
 * "Attach CLA" or "Change CLA" on one repository (E18-S10): a dialog with the documents the repository may enforce, to attach one or to
 * detach the one it has. The dialog stays open while the request is out (a close is refused then) and when it fails, and the screen closes
 * it when the lists have been asked for again. Focus returns to the button. The name of the button holds the repository, so the buttons of
 * a list are told apart.
 */
export function AttachAction({
  installationId,
  repository,
  role,
  suspended,
  open,
  onOpenChange,
  onOutcome,
}: AttachActionProps) {
  const t = useT();
  const attach = useAttachDocument({
    installationId,
    repository: { id: repository.id, fullName: repository.fullName },
    onOutcome,
  });
  const attached = repository.document !== null;
  const name = visibleText(repository.fullName);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          attach.reset();
          onOpenChange(true);
        } else if (!attach.pending) {
          onOpenChange(false);
        }
      }}
      title={
        <>
          {t('repositories.attach.title')} <UserText>{repository.fullName}</UserText>
        </>
      }
      description={t('repositories.attach.description')}
      trigger={
        <Button
          variant="secondary"
          disabled={suspended}
          aria-label={t(attached ? 'repositories.attach.changeLabel' : 'repositories.attach.label', {
            repository: name,
          })}
        >
          {t(attached ? 'repositories.attach.change' : 'repositories.attach')}
        </Button>
      }
    >
      <AttachForm installationId={installationId} repository={repository} role={role} attach={attach} />
    </Dialog>
  );
}
