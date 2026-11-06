// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { UseQueryResult } from '@tanstack/react-query';
import type { z } from 'zod';
import type { erasurePreviewSchema } from '../../../shared/erasure.ts';
import { useT } from '../../i18n/index.ts';
import { ErrorState } from '../../states/ErrorState.tsx';
import { LoadingState } from '../../states/LoadingState.tsx';
import { Heading } from '../../ui/Heading.tsx';
import { StatusMessage } from '../../ui/StatusMessage.tsx';

type Counts = z.infer<typeof erasurePreviewSchema>;

export interface ErasePreviewProps {
  readonly preview: UseQueryResult<Counts>;
  /** The installation holds nothing of the person (`404` from the preview or from the erasure): there is nothing to erase. */
  readonly nothingHeld: boolean;
}

/** A list of what an erasure does to one kind of thing, under a heading of its own. */
function Effects({ title, items }: { readonly title: string; readonly items: readonly string[] }) {
  return (
    <section className="flex flex-col gap-1">
      <Heading level={3}>{title}</Heading>
      <ul className="list-disc pl-5">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

/**
 * What the erasure of one person would do in this installation (E18-S14), from the counts the server made when the question opened and
 * no personal data: what is removed (the name, email address and login the person gave, the login shown on allowlist entries and kept with corporate
 * approvals that name them (E21), and their sessions when no other installation holds data about them) and what stays (the signatures, as legal evidence, and the
 * person's right to sign again). While the counts are on their way, and again while they are read anew after `count_changed`, the
 * place shows the loading state; a failure is the error banner with "Try again" where it can help; an installation that holds nothing of the
 * person says so.
 */
export function ErasePreview({ preview, nothingHeld }: ErasePreviewProps) {
  const t = useT();
  if (nothingHeld) {
    return <StatusMessage tone="info">{t('erase.nothing')}</StatusMessage>;
  }
  if (preview.isError) {
    return (
      <ErrorState variant="banner" error={preview.error} refetch={preview.refetch} retrying={preview.isFetching} />
    );
  }
  const counts = preview.data;
  if (counts === undefined || preview.isFetching) {
    return <LoadingState />;
  }
  const removed = [
    t.plural('erase.removes.pii', counts.signerPiiRows),
    ...(counts.allowlistEntries === 0 ? [] : [t.plural('erase.removes.allowlist', counts.allowlistEntries)]),
    ...(counts.corporateApprovals === 0 ? [] : [t.plural('erase.removes.corporate', counts.corporateApprovals)]),
    t('erase.removes.sessions'),
  ];
  const kept = [t.plural('erase.stays.signatures', counts.signatures), t('erase.stays.again')];
  return (
    <div className="flex flex-col gap-3">
      <Effects title={t('erase.removes')} items={removed} />
      <Effects title={t('erase.stays')} items={kept} />
    </div>
  );
}
