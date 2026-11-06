// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { EmptyState } from '../states/EmptyState.tsx';

/**
 * What a scope with no entry of its own says (E18-S06): accounts on the allowlist are exempt from signing, a bot is matched by the type of
 * the account and its numeric id, and a login on screen is a snapshot for display and never what matching reads.
 */
export function EmptyAllowlist() {
  const t = useT();
  return <EmptyState level={3} title={t('allowlist.empty.title')} description={t('allowlist.empty.description')} />;
}
