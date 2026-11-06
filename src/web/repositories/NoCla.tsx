// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { InstallationRole } from '../../shared/installations.ts';
import { useT } from '../i18n/index.ts';
import { Button } from '../ui/index.ts';
import { EditorLink } from './EditorLink.tsx';
import { editorTargetOf } from './editor-target.ts';
import type { Repository } from './repository-queries.ts';

export interface NoClaProps {
  /** `installations.id` of the tenant in the address. */
  readonly installationId: number;
  readonly repository: Repository;
  readonly role: InstallationRole | undefined;
  /** The installation is suspended: nothing here writes. */
  readonly suspended: boolean;
  /** Opens the dialog that attaches a CLA. */
  readonly onAttach: () => void;
}

/**
 * The way out of `409 no_active_cla` (E18-S10): the button that opens the attach dialog of the row, and the link to the editor of the
 * attached document, or to the list of documents when none is attached and the person is an org admin.
 */
export function NoCla({ installationId, repository, role, suspended, onAttach }: NoClaProps) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="secondary" disabled={suspended} onClick={onAttach}>
        {t('repositories.fix.attach')}
      </Button>
      <EditorLink installationId={installationId} target={editorTargetOf(repository.document ?? undefined, role)} />
    </div>
  );
}
