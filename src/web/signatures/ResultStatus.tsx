// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { StatusMessage } from '../ui/index.ts';
import type { SignaturePage } from './signature-queries.ts';
import type { RevokeOutcome } from './use-revoke-signature.ts';

export interface ResultStatusProps {
  /** The page on screen, once there is one. */
  readonly shown: SignaturePage | undefined;
  /** What the last revocation did, if there was one. */
  readonly notice: RevokeOutcome | undefined;
  /** How many rows of personal data the last erasure removed, if there was one (E18-S14). */
  readonly erased: number | undefined;
}

/**
 * What the results say in words (E18-S07), each in a polite live region that is in the page before its text changes: how many signatures
 * the page holds (announced after each search), what the last revocation did, what the last erasure of personal data removed (E18-S14), and
 * that a repository admin's search was cut short.
 */
export function ResultStatus({ shown, notice, erased }: ResultStatusProps) {
  const t = useT();
  const truncated = shown?.truncated === true;
  return (
    <>
      <StatusMessage>{shown === undefined ? null : t.plural('signatures.count', shown.items.length)}</StatusMessage>
      <StatusMessage tone={notice === 'revoked' ? 'success' : 'info'}>
        {notice === undefined ? null : t(`signatures.notice.${notice}`)}
      </StatusMessage>
      <StatusMessage tone={erased === undefined ? 'neutral' : 'success'}>
        {erased === undefined ? null : t.plural('erase.done', erased)}
      </StatusMessage>
      <StatusMessage tone={truncated ? 'warning' : 'neutral'}>
        {truncated ? t('signatures.truncated') : null}
      </StatusMessage>
    </>
  );
}
