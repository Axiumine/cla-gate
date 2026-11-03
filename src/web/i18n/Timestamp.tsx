// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useFormatters, useT } from './context.ts';
import { type Instant, parseInstant } from './format.ts';

export interface TimestampProps {
  readonly value: Instant;
  /** Evidence times (`signed_at`, `published_at`, an audit time) pass this and read `YYYY-MM-DD HH:mm UTC`; the rest shows the viewer's local time. */
  readonly utc?: boolean;
}

/** A moment as a `<time dateTime>` element, so assistive technology and copy-paste get the machine-readable value (E17-S02). */
export function Timestamp({ value, utc = false }: TimestampProps) {
  const t = useT();
  const { formatDateTime, formatUtc } = useFormatters();
  const instant = parseInstant(value);
  if (instant === null) {
    return <span>{t('common.unknownDate')}</span>;
  }
  return <time dateTime={instant.toISOString()}>{utc ? formatUtc(instant) : formatDateTime(instant)}</time>;
}
