// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Outlet } from '@tanstack/react-router';
import { SuspendedBanner } from './SuspendedBanner.tsx';

export interface TenantLayoutProps {
  /** `installations.id` of the tenant in the address. */
  readonly installationId: number;
}

/**
 * The frame of every screen below `/installations/$installationId` (E18-S04): the suspended banner of the tenant, then the
 * screen. The tenant is the one in the address and nothing else; a screen reads data only through queries whose key starts
 * with that installation, and it is the server that decides whether the person may see them.
 */
export function TenantLayout({ installationId }: TenantLayoutProps) {
  return (
    <div className="flex flex-col gap-6">
      <SuspendedBanner installationId={installationId} />
      <Outlet />
    </div>
  );
}
