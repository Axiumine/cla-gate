// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Dispatch, useState } from 'react';
import { useT } from '../../i18n/index.ts';
import { useInstallation } from '../../installations/use-installations.ts';
import { Button, Dialog } from '../../ui/index.ts';
import type { DocumentIds } from '../document-queries.ts';
import type { ActiveVersion, EditorAction } from '../editor-state.ts';
import { PublishForm } from '../PublishForm.tsx';
import { editorOutcomes, type PublishOutcomes } from '../use-publish-request.ts';
import { formatVersion } from '../version-number.ts';
import type { VersionDetail } from './history-queries.ts';

export interface RestoreActionProps {
  readonly ids: DocumentIds;
  /** The old version whose text is published again. */
  readonly version: VersionDetail;
  /** The version the editor knows as the active one: what the publish is held to (`expectedActiveVersionId`) and the major the copy is compared with. */
  readonly active: ActiveVersion | null;
  readonly dispatch: Dispatch<EditorAction>;
}

/**
 * "Restore this text" on an old version (E18-S11): the publish dialog of E18-S05 with the source `{ type: 'version', versionId }`. It says
 * that publishing creates a new version and that the old row is never reactivated, offers `minor` only when the old version is of the
 * active major (otherwise the rule `rollback_requires_major` is shown as the reason), and asks for the rationale and the re-signing
 * confirmation as the editor's dialog does. The dialog closes when the version is made, which becomes the active one in the editor, or
 * when another admin published first (`stale_active_version`): then the history says so and offers "Load latest". Nothing is written
 * while the installation is suspended.
 */
export function RestoreAction({ ids, version, active, dispatch }: RestoreActionProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const suspended = useInstallation(ids.installationId)?.suspended === true;
  const number = formatVersion(version);
  const outcomes: PublishOutcomes = {
    ...editorOutcomes(dispatch),
    published: (published) => {
      dispatch({ type: 'restored', published, text: version.contentMd });
      setOpen(false);
    },
    stale: () => {
      dispatch({ type: 'stale' });
      setOpen(false);
    },
  };
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={t('restore.title', { version: number })}
      description={t('restore.description', { version: number })}
      trigger={<Button disabled={suspended}>{t('restore.action')}</Button>}
    >
      <PublishForm
        ids={ids}
        target={{ from: { type: 'version', versionId: version.id, major: version.major }, active }}
        text={version.contentMd}
        outcomes={outcomes}
      />
    </Dialog>
  );
}
