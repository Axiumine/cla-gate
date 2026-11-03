// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { afterEach, expect, test, vi } from 'vitest';
import { createFormatters, parseInstant } from './format.ts';

afterEach(() => {
  vi.unstubAllEnvs();
});

/** The formatters of `locale` for a viewer whose browser reports the time zone `zone`. */
function formattersIn(zone: string, locale = 'en') {
  vi.stubEnv('TZ', zone);
  return createFormatters(locale);
}

const NOON_UTC = '2026-11-02T12:00:00Z';
const LATE_UTC = '2026-11-02T23:30:00Z';

test.each([
  ['an ISO string', '2026-11-02T10:00:00Z', '2026-11-02T10:00:00.000Z'],
  ['an ISO string with an offset', '2026-11-02T10:00:00+02:00', '2026-11-02T08:00:00.000Z'],
  ['a Date', new Date('2026-11-02T10:00:00Z'), '2026-11-02T10:00:00.000Z'],
])('parseInstant reads %s', (_what, value, iso) => {
  expect(parseInstant(value)?.toISOString()).toBe(iso);
});

test.each([
  ['text that is not a date', 'not a date'],
  ['an empty string', ''],
  ['markup', '<img src=x onerror=alert(1)>'],
  ['an invalid Date', new Date(Number.NaN)],
])('parseInstant answers null for %s', (_what, value) => {
  expect(parseInstant(value)).toBeNull();
});

test('formatNumber groups digits the way the locale does', () => {
  expect(formattersIn('UTC').formatNumber(1234567.5)).toBe('1,234,567.5');
  expect(formattersIn('UTC', 'de').formatNumber(1234567.5)).toBe('1.234.567,5');
});

test('formatDate shows the calendar date in the time zone of the viewer', () => {
  expect(formattersIn('America/Los_Angeles').formatDate(LATE_UTC)).toBe('Nov 2, 2026');
  expect(formattersIn('Pacific/Auckland').formatDate(LATE_UTC)).toBe('Nov 3, 2026');
});

test('formatDate takes a Date as well as text', () => {
  expect(formattersIn('UTC').formatDate(new Date(NOON_UTC))).toBe('Nov 2, 2026');
});

test('formatDate follows the locale', () => {
  expect(formattersIn('UTC', 'de').formatDate(NOON_UTC)).toBe('02.11.2026');
});

test('formatDateTime shows date and time in the time zone of the viewer', () => {
  expect(formattersIn('America/Los_Angeles').formatDateTime(NOON_UTC)).toMatch(/^Nov 2, 2026, 4:00\sAM$/);
  expect(formattersIn('Pacific/Auckland').formatDateTime(NOON_UTC)).toMatch(/^Nov 3, 2026, 1:00\sAM$/);
});

test.each([['UTC'], ['America/Los_Angeles'], ['Pacific/Auckland'], ['Asia/Kolkata']])(
  'formatUtc shows YYYY-MM-DD HH:mm UTC whatever the time zone of the viewer: %s',
  (zone) => {
    expect(formattersIn(zone).formatUtc(LATE_UTC)).toBe('2026-11-02 23:30 UTC');
  },
);

test('formatUtc is the same in every locale, and pads single digits', () => {
  expect(formattersIn('UTC', 'de').formatUtc('2026-01-02T03:04:05Z')).toBe('2026-01-02 03:04 UTC');
});

test.each([
  ['formatDate', (f: ReturnType<typeof createFormatters>) => f.formatDate('<b>nope</b>')],
  ['formatDateTime', (f: ReturnType<typeof createFormatters>) => f.formatDateTime('<b>nope</b>')],
  ['formatUtc', (f: ReturnType<typeof createFormatters>) => f.formatUtc('<b>nope</b>')],
])('%s refuses an invalid moment with an error that does not repeat the value', (_name, run) => {
  expect(() => run(createFormatters('en'))).toThrow(new RangeError('Not a valid date or time'));
});
