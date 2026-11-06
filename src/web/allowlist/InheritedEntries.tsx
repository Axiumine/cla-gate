// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Heading } from '../ui/Heading.tsx';
import type { Entry } from './allowlist-queries.ts';
import { EntriesTable } from './EntriesTable.tsx';

export interface InheritedEntriesProps {
  readonly entries: readonly Entry[];
}

/**
 * The entries a repository inherits (E18-S06), read-only: the installation made them and they exempt accounts here too, so the admin sees
 * the effective list. They have no removal; they are removed from the whole-installation scope. Nothing is drawn when there are none.
 */
export function InheritedEntries({ entries }: InheritedEntriesProps) {
  const t = useT();
  if (entries.length === 0) {
    return null;
  }
  return (
    <section className="flex flex-col gap-3">
      <Heading level={2}>{t('allowlist.inherited.title')}</Heading>
      <p className="max-w-prose text-fg-muted">{t('allowlist.inherited.description')}</p>
      <EntriesTable caption={t('allowlist.inherited.caption')} entries={entries} />
    </section>
  );
}
