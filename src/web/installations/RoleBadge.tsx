// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { InstallationRole } from '../../shared/installations.ts';
import { Badge } from '../ui/Badge.tsx';

export interface RoleBadgeProps {
  readonly role: InstallationRole;
}

/** What the person is in an installation, in words: `Org admin` or `Repo admin`. */
export function RoleBadge({ role }: RoleBadgeProps) {
  return <Badge status={role} />;
}
