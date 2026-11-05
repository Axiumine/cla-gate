// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Link } from '@tanstack/react-router';
import { useT } from '../i18n/index.ts';
import { sectionLabel, TENANT_SECTIONS, TENANT_START } from './tenant-sections.ts';
import { useInstallation } from './use-installations.ts';

export interface TenantNavProps {
  /** `installations.id` of the tenant in the address. */
  readonly installationId: number;
}

/**
 * The links to the screens of one tenant (E18-S05), for the screens the person's role can open (the table of
 * `tenant-sections.ts`). While the role is not known (the list of installations has not answered, or does not hold this tenant)
 * only the start of the tenant is offered; the server decides on every request, so a link is a convenience and never the
 * access control. The current screen's link carries `aria-current="page"`, which the router sets.
 */
export function TenantNav({ installationId }: TenantNavProps) {
  const t = useT();
  const role = useInstallation(installationId)?.role;
  const sections = TENANT_SECTIONS.filter((section) =>
    role === undefined ? section.to === TENANT_START : section.roles.includes(role),
  );
  return (
    <nav aria-label={t('tenant.nav.label')}>
      <ul className="flex flex-wrap gap-4">
        {sections.map((section) => (
          <li key={section.to}>
            <Link
              to={section.to}
              params={{ installationId }}
              activeOptions={{ exact: section.to === TENANT_START }}
              className="underline-offset-2 hover:underline aria-[current=page]:font-semibold"
            >
              {t(sectionLabel(section.to))}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
