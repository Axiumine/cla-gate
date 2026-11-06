// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Link } from '@tanstack/react-router';
import { useT } from '../i18n/index.ts';
import { visibleText } from '../ui/user-text.ts';
import type { Repository } from './repository-queries.ts';

export interface SettingsLinkProps {
  /** `installations.id` of the tenant in the address. */
  readonly installationId: number;
  readonly repository: Repository;
}

/**
 * The link from a row to the settings screen of the repository (E22-S03, linked by E18-S10), where the public badge is switched on and
 * its snippet copied. It is on the rows the viewer administers, as the server judges the settings by the same role. The repository is
 * named in the accessible name through `visibleText`, so a name a person controls is read as text and never as markup.
 */
export function SettingsLink({ installationId, repository }: SettingsLinkProps) {
  const t = useT();
  return (
    <Link
      to="/installations/$installationId/repositories/$repositoryId/settings"
      params={{ installationId, repositoryId: repository.id }}
      aria-label={t('repositories.settings.label', { repository: visibleText(repository.fullName) })}
      className="self-center underline underline-offset-2"
    >
      {t('repositories.settings')}
    </Link>
  );
}
