// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Link } from '@tanstack/react-router';
import type { InstallationSummary } from '../../shared/installations.ts';
import { UserText } from '../ui/UserText.tsx';
import { switchTarget, TENANT_SECTIONS, TENANT_START } from './tenant-sections.ts';

export interface SwitcherListProps {
  readonly id: string;
  readonly installations: readonly InstallationSummary[];
  /** `installations.id` of the tenant in the address, if any. */
  readonly active: number | undefined;
  /** The route that is showing (its full path), for keeping the person on the same screen. */
  readonly here: string | undefined;
  /** The person chose an installation. */
  readonly onChoose: () => void;
}

/** The installations the person can switch to, one link each; the active one carries `aria-current`. */
export function SwitcherList({ id, installations, active, here, onChoose }: SwitcherListProps) {
  return (
    <ul
      id={id}
      className="absolute end-0 z-10 mt-1 flex min-w-48 flex-col gap-1 rounded-md border border-line bg-surface p-2 shadow-md"
    >
      {installations.map((installation) => (
        <li key={installation.id}>
          <Link
            to={switchTarget(TENANT_SECTIONS, TENANT_START, here, installation.role)}
            params={{ installationId: installation.id }}
            aria-current={installation.id === active ? 'true' : undefined}
            className="block rounded-sm px-2 py-1 underline-offset-2 hover:underline aria-[current=true]:font-semibold"
            onClick={onChoose}
          >
            <UserText>{installation.accountLogin}</UserText>
          </Link>
        </li>
      ))}
    </ul>
  );
}
