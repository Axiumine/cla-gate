// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { InstallationRole } from '../../shared/installations.ts';
import { useT } from '../i18n/index.ts';
import { Tabs } from '../ui/index.ts';
import { OverridesTab } from './OverridesTab.tsx';
import { type PendingFilters, PendingTab } from './PendingTab.tsx';
import { type PendingSearch, type PendingTab as TabName, tabFromValue, tabOf } from './pending-search.ts';

export interface PendingTabsProps {
  /** `installations.id` of the tenant in the address. */
  readonly installationId: number;
  /** The role of the person in this installation, when the list of installations has it. */
  readonly role: InstallationRole | undefined;
  /** Whether the installation is suspended: nothing is recorded or removed then. */
  readonly suspended: boolean;
  /** What the address holds, once validated. */
  readonly search: PendingSearch;
  /** Puts the other tab in the address; the filters and the page of one tab are not the other's. */
  readonly onTabChange: (tab: TabName) => void;
  /** Puts other filters in the address; the page starts again from the first. */
  readonly onFiltersChange: (filters: PendingFilters) => void;
  readonly onCursorChange: (cursor: string | undefined) => void;
  /** Replaces the address with the first page. */
  readonly onFirstPage: () => void;
}

/** The two tabs of the pending screen (E18-S08), the one the address names on screen. */
export function PendingTabs({
  installationId,
  role,
  suspended,
  search,
  onTabChange,
  onFiltersChange,
  onCursorChange,
  onFirstPage,
}: PendingTabsProps) {
  const t = useT();
  const shared = { installationId, role, suspended, cursor: search.cursor, onCursorChange, onFirstPage };
  return (
    <Tabs
      label={t('pending.tabs.label')}
      value={tabOf(search)}
      onValueChange={(value) => {
        onTabChange(tabFromValue(value));
      }}
      items={[
        {
          value: 'pending',
          label: t('pending.tab.pending'),
          panel: (
            <PendingTab
              {...shared}
              filters={{ repository: search.repository, reason: search.reason }}
              onFiltersChange={onFiltersChange}
            />
          ),
        },
        {
          value: 'overrides',
          label: t('pending.tab.overrides'),
          panel: (
            <OverridesTab
              {...shared}
              repositoryId={search.repository}
              onRepositoryChange={(repository) => {
                onFiltersChange({ repository, reason: undefined });
              }}
            />
          ),
        },
      ]}
    />
  );
}
