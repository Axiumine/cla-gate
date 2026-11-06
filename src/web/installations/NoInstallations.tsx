// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Link } from '@tanstack/react-router';
import { useT } from '../i18n/index.ts';
import { useInstallLink } from '../meta/meta.ts';
import { EmptyState } from '../states/EmptyState.tsx';
import { InstallAnchor } from './InstallAnchor.tsx';

/**
 * The person administers no installation (E18-S04). It explains how to install the App and links to GitHub's page for it when
 * the instance has an App to install; when it has none (`installUrl` is `null`) it tells the operator to finish the first-run
 * setup instead. Until `GET /api/meta` has answered, and when it cannot be read, the explanation stands without a link.
 */
export function NoInstallations() {
  const t = useT();
  const install = useInstallLink();
  if (install.kind === 'setup') {
    return (
      <EmptyState
        level={2}
        title={t('installations.empty.title')}
        description={t('installations.empty.setup')}
        action={
          <Link to="/setup" className="underline underline-offset-2">
            {t('installations.empty.setupLink')}
          </Link>
        }
      />
    );
  }
  return (
    <EmptyState
      level={2}
      title={t('installations.empty.title')}
      description={t('installations.empty.description')}
      action={
        install.kind === 'link' ? (
          <InstallAnchor href={install.href}>{t('installations.empty.install')}</InstallAnchor>
        ) : undefined
      }
    />
  );
}
