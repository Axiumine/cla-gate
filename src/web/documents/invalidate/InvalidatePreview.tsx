// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { UseQueryResult } from '@tanstack/react-query';
import type { InvalidationPreviewResponse } from '../../../shared/signature-invalidate.ts';
import { useFormatters, useT } from '../../i18n/index.ts';
import { ErrorState } from '../../states/ErrorState.tsx';
import { LoadingState } from '../../states/LoadingState.tsx';
import { StatusMessage } from '../../ui/StatusMessage.tsx';

export interface InvalidatePreviewProps {
  readonly major: number;
  readonly preview: UseQueryResult<InvalidationPreviewResponse>;
}

/**
 * What invalidating a major would do (E18-S14), as the server counted it: how many signatures are in force and how many repositories
 * are checked again. Counts only, so there is no person to name. While the count is on its way, and again while it is read anew after
 * `count_changed`, the place shows the loading state; a failure (a `403`, the uniform `404`, GitHub down) is the error banner with
 * "Try again" where it can help; a count of zero says that there is nothing to invalidate.
 */
export function InvalidatePreview({ major, preview }: InvalidatePreviewProps) {
  const t = useT();
  const { formatNumber } = useFormatters();
  if (preview.isError) {
    return (
      <ErrorState variant="banner" error={preview.error} refetch={preview.refetch} retrying={preview.isFetching} />
    );
  }
  const counts = preview.data;
  if (counts === undefined || preview.isFetching) {
    return <LoadingState />;
  }
  if (counts.activeSignatures === 0) {
    return <StatusMessage tone="info">{t('invalidate.nothing', { major })}</StatusMessage>;
  }
  return (
    <dl
      aria-label={t('invalidate.preview.label', { major })}
      className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1"
    >
      <dt className="font-medium">{t('invalidate.preview.activeSignatures')}</dt>
      <dd>{formatNumber(counts.activeSignatures)}</dd>
      <dt className="font-medium">{t('invalidate.preview.affectedRepositories')}</dt>
      <dd>{formatNumber(counts.affectedRepositories)}</dd>
    </dl>
  );
}
