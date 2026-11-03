// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/** A moment as the API sends it (an ISO-8601 string, E17-S04) or as a `Date`. */
export type Instant = string | Date;

/** The formatters of one locale (E17-S02). */
export interface Formatters {
  /** A number with the locale's digit grouping and decimal mark. */
  readonly formatNumber: (value: number) => string;
  /** The calendar date in the viewer's time zone, for example `Nov 2, 2026`. */
  readonly formatDate: (value: Instant) => string;
  /** The date and the time in the viewer's time zone, for example `Nov 2, 2026, 11:00 AM`. */
  readonly formatDateTime: (value: Instant) => string;
  /** The evidence format in UTC, `YYYY-MM-DD HH:mm UTC`, the same in every locale and every time zone. */
  readonly formatUtc: (value: Instant) => string;
}

/** The moment as a `Date`, or null when the text or the date is not a real moment. */
export function parseInstant(value: Instant): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The moment as a `Date`; an invalid one is a bug of the caller, and the error never repeats the value. */
function requireInstant(value: Instant): Date {
  const date = parseInstant(value);
  if (date === null) {
    throw new RangeError('Not a valid date or time');
  }
  return date;
}

/** `Intl` formatters for `locale`. The time zone is the viewer's: the one the browser reports when none is given. */
export function createFormatters(locale: string): Formatters {
  const numbers = new Intl.NumberFormat(locale);
  const dates = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  const dateTimes = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  return {
    formatNumber: (value) => numbers.format(value),
    formatDate: (value) => dates.format(requireInstant(value)),
    formatDateTime: (value) => dateTimes.format(requireInstant(value)),
    formatUtc: (value) => {
      const iso = requireInstant(value).toISOString();
      return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
    },
  };
}
