// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { StatusMessage } from '../ui/StatusMessage.tsx';
import { useInstallation } from './use-installations.ts';

export interface SuspendedBannerProps {
  readonly installationId: number;
}

/**
 * The read-only notice of a suspended tenant (E18-S04): GitHub suspended the App on the installation, so its screens only read.
 * The signatures are retained, and the server answers every write with `409 installation_suspended`; the write controls of the
 * screens below an installation are disabled while this shows (they read the same summary through `useInstallation`).
 */
export function SuspendedBanner({ installationId }: SuspendedBannerProps) {
  const t = useT();
  return useInstallation(installationId)?.suspended === true ? (
    <StatusMessage tone="warning">{t('installation.suspended')}</StatusMessage>
  ) : null;
}
