// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { InstallationRole } from '../../shared/installations.ts';
import { useT } from '../i18n/index.ts';
import { Button } from '../ui/index.ts';
import { visibleText } from '../ui/user-text.ts';
import { NoCla } from './NoCla.tsx';
import { RepositoryFailure } from './RepositoryFailure.tsx';
import type { Repository } from './repository-queries.ts';
import type { RepositoryOutcome } from './use-repository-change.ts';
import { useSwitchRepository } from './use-switch-repository.ts';

export interface EnableActionProps {
  /** `installations.id` of the tenant in the address. */
  readonly installationId: number;
  readonly repository: Repository;
  readonly role: InstallationRole | undefined;
  /** The installation is suspended: nothing here writes. */
  readonly suspended: boolean;
  /** Opens the dialog that attaches a CLA, for the person who has to before the check can be on. */
  readonly onAttach: () => void;
  /** Told how the change ended, once the lists have been asked for again. */
  readonly onOutcome: (outcome: RepositoryOutcome) => void;
}

/**
 * "Enable" on a repository that does not enforce the CLA (E18-S10): sends the request at once, once at a time. `409 no_active_cla` shows
 * the fix under the button, "attach a CLA and publish a version first", with the button that opens the attach dialog and the link to the
 * editor of the attached document (to the list of documents when none is attached and the person is an org admin). Any other failure
 * is shown under the button too, with "Try again" where it can help. The failure goes away when the row changes (the screen keys this
 * component by the document the repository has).
 */
export function EnableAction({ installationId, repository, role, suspended, onAttach, onOutcome }: EnableActionProps) {
  const t = useT();
  const change = useSwitchRepository('enable', {
    installationId,
    repository: { id: repository.id, fullName: repository.fullName },
    onOutcome,
  });
  const enable = () => {
    change.send(undefined);
  };
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        variant="primary"
        disabled={suspended}
        loading={change.pending}
        aria-label={t('repositories.enable.label', { repository: visibleText(repository.fullName) })}
        onClick={enable}
      >
        {t('repositories.enable')}
      </Button>
      {change.failure === undefined ? null : (
        <RepositoryFailure
          error={change.failure}
          retry={enable}
          retrying={change.pending}
          fix={(rule) =>
            rule === 'no_active_cla' ? (
              <NoCla
                installationId={installationId}
                repository={repository}
                role={role}
                suspended={suspended}
                onAttach={onAttach}
              />
            ) : null
          }
        />
      )}
    </div>
  );
}
