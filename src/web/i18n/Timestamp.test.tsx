// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { renderWithProviders } from '../test-support/render.tsx';
import { messages } from './messages.ts';
import { Timestamp } from './Timestamp.tsx';

afterEach(() => {
  vi.unstubAllEnvs();
});

const SIGNED_AT = '2026-11-02T10:15:00Z';

test('an evidence time shows YYYY-MM-DD HH:mm UTC in a <time> element with the ISO value', () => {
  vi.stubEnv('TZ', 'Pacific/Auckland');
  renderWithProviders(<Timestamp value={SIGNED_AT} utc />);
  const time = screen.getByText('2026-11-02 10:15 UTC');
  expect(time.tagName).toBe('TIME');
  expect(time).toHaveAttribute('datetime', '2026-11-02T10:15:00.000Z');
});

test('any other time shows the date and time of the viewer, in their time zone', () => {
  vi.stubEnv('TZ', 'America/Los_Angeles');
  renderWithProviders(<Timestamp value={SIGNED_AT} />);
  const time = screen.getByText(/^Nov 2, 2026, 2:15\sAM$/);
  expect(time.tagName).toBe('TIME');
  expect(time).toHaveAttribute('datetime', '2026-11-02T10:15:00.000Z');
});

test('the same moment gives the same dateTime whatever the zone and whether or not utc is set', () => {
  vi.stubEnv('TZ', 'Asia/Kolkata');
  const { container } = renderWithProviders(
    <>
      <Timestamp value={SIGNED_AT} />
      <Timestamp value={SIGNED_AT} utc />
    </>,
  );
  expect([...container.querySelectorAll('time')].map((time) => time.getAttribute('datetime'))).toEqual([
    '2026-11-02T10:15:00.000Z',
    '2026-11-02T10:15:00.000Z',
  ]);
});

test('a Date is shown like its ISO text', () => {
  renderWithProviders(<Timestamp value={new Date(SIGNED_AT)} utc />);
  expect(screen.getByText('2026-11-02 10:15 UTC')).toHaveAttribute('datetime', '2026-11-02T10:15:00.000Z');
});

test.each([
  ['text that is no date', 'yesterday-ish'],
  ['an empty string', ''],
  ['an invalid Date', new Date(Number.NaN)],
  ['markup', '<img src=x onerror=alert(1)>'],
])('%s shows the catalog text for an unknown date, no <time> and none of the value', (_what, value) => {
  const { container } = renderWithProviders(<Timestamp value={value} utc />);
  expect(screen.getByText(messages['common.unknownDate'])).toBeInTheDocument();
  expect(container.querySelector('time, img')).toBeNull();
  expect(container).not.toHaveTextContent('onerror');
});
