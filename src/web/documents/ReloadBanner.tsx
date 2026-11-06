// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Button } from '../ui/Button.tsx';
import type { ReloadKind } from './use-reload.ts';

export interface ReloadBannerProps {
  /** What changed under the editor: the draft another admin saved, or the version another admin published. */
  readonly kind: ReloadKind;
  /** "Load latest" is under way: its button is busy. */
  readonly pending: boolean;
  readonly onReload: () => void;
}

/**
 * A notice of the editor that needs the person's attention and has one action (E18-S05): another admin saved the draft
 * (`409 draft_conflict`), or published a version (`409 stale_active_version`), meanwhile. It is an alert, so a screen reader
 * announces it when it appears, and nothing on the screen changes until the person presses "Load latest".
 */
export function ReloadBanner({ kind, pending, onReload }: ReloadBannerProps) {
  const t = useT();
  const draft = kind === 'draft';
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-md border border-transparent bg-warning-bg px-3 py-2 text-warning-fg"
    >
      <p className="font-semibold">{t(draft ? 'editor.conflict.title' : 'editor.stale.title')}</p>
      <p>{t(draft ? 'editor.conflict.message' : 'editor.stale.message')}</p>
      <Button variant="secondary" loading={pending} onClick={onReload}>
        {t(draft ? 'editor.conflict.load' : 'editor.stale.load')}
      </Button>
    </div>
  );
}
