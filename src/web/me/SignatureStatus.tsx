// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Link } from '@tanstack/react-router';
import { Timestamp, useT } from '../i18n/index.ts';
import { Badge } from '../ui/Badge.tsx';
import { resignRepositoryId } from './resign-target.ts';
import type { Item } from './SignatureCells.tsx';

export interface SignatureStatusProps {
  readonly item: Item;
}

/**
 * Where a signature stands (E18-S03), in words: a badge from `state`, the date of the revocation on a revoked one, the reason
 * an outdated one no longer covers the person (a newer major is required), and the way to the sign page when the server gave one.
 * No reason of a revocation is shown, because the API never returns one to the signer.
 */
export function SignatureStatus({ item }: SignatureStatusProps) {
  const t = useT();
  const githubRepoId = resignRepositoryId(item.resignPath);
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge status={item.state} />
      {item.revokedAt === null ? null : (
        <span>
          {t('me.signatures.revokedOn')} <Timestamp value={item.revokedAt} utc />
        </span>
      )}
      {item.state === 'outdated' ? <span className="text-fg-muted">{t('me.signatures.outdated')}</span> : null}
      {githubRepoId === undefined ? null : (
        <Link to="/sign/$githubRepoId" params={{ githubRepoId }} className="underline underline-offset-2">
          {t('me.signatures.signAgain')}
        </Link>
      )}
    </div>
  );
}
