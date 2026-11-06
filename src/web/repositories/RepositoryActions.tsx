// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useState } from 'react';
import { useVanished } from '../ui/use-vanished.ts';
import { AttachAction } from './AttachAction.tsx';
import { DisableAction } from './DisableAction.tsx';
import { EnableAction } from './EnableAction.tsx';
import { enableKey } from './enable-key.ts';
import type { Repository } from './repository-queries.ts';
import type { RowActions } from './row-actions.ts';
import { SettingsLink } from './SettingsLink.tsx';
import type { RepositoryOutcome } from './use-repository-change.ts';

export interface RepositoryActionsProps {
  readonly actions: RowActions;
  readonly repository: Repository;
}

/**
 * The actions on one repository the viewer administers (E18-S10): attach or change its CLA, enable the check or disable it, and open
 * its settings (E22-S03). The attach dialog is held here, because the refusal of an enable with no CLA offers to open it. A row that
 * leaves the list after a change takes its buttons with it, and `onVanished` runs so the screen can put focus somewhere.
 */
export function RepositoryActions({ actions, repository }: RepositoryActionsProps) {
  const [attachOpen, setAttachOpen] = useState(false);
  const settle = useVanished(actions.onVanished);
  const { installationId, role, suspended } = actions;
  const report = (outcome: RepositoryOutcome) => {
    settle();
    setAttachOpen(false);
    actions.onOutcome(outcome);
  };
  return (
    <div className="flex flex-wrap items-start gap-2">
      <AttachAction
        installationId={installationId}
        repository={repository}
        role={role}
        suspended={suspended}
        open={attachOpen}
        onOpenChange={setAttachOpen}
        onOutcome={report}
      />
      {repository.enabled ? (
        <DisableAction
          installationId={installationId}
          repository={repository}
          suspended={suspended}
          onOutcome={report}
        />
      ) : (
        <EnableAction
          key={enableKey(repository)}
          installationId={installationId}
          repository={repository}
          role={role}
          suspended={suspended}
          onAttach={() => {
            setAttachOpen(true);
          }}
          onOutcome={report}
        />
      )}
      <SettingsLink installationId={installationId} repository={repository} />
    </div>
  );
}
