// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Heading } from '../ui/Heading.tsx';

/**
 * What the maintainers of an organisation can see of a signature (E18-S03), in the catalog's words and stated exactly: the name
 * the person typed, their GitHub login and the verified e-mail they chose. This list holds none of the three; it is the person's
 * own, and nobody else is shown it.
 */
export function MaintainerNotice() {
  const t = useT();
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
      <Heading level={2}>{t('me.signatures.notice.title')}</Heading>
      <p>{t('me.signatures.notice.body')}</p>
    </div>
  );
}
