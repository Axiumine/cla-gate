// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Heading } from '../ui/Heading.tsx';
import type { RepositoryIds } from './badge-state.ts';
import { PublicBadgeSettings } from './PublicBadgeSettings.tsx';

/**
 * The settings screen of a repository (E22-S03): at `/installations/$installationId/repositories/$repositoryId/settings`, for a
 * signed-in person. It holds the public badge today (the opt-in switch and the snippet for a README); the server decides who may see
 * and change it, so a person without the role is shown the forbidden or the not-found state and nothing else. The ids are those of
 * the address, which the router has read as positive integers.
 */
export function RepositorySettingsPage(ids: RepositoryIds) {
  const t = useT();
  return (
    <div className="flex flex-col items-start gap-6">
      <Heading level={1}>{t('repository.settings.title')}</Heading>
      <PublicBadgeSettings {...ids} />
    </div>
  );
}
