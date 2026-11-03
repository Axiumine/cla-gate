// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { I18nProvider } from './I18nProvider.tsx';
import { useFormatters, useLocale, useT } from './index.ts';
import { messages } from './messages.ts';

afterEach(() => {
  document.documentElement.lang = 'en';
  vi.restoreAllMocks();
});

/** Shows what the provider supplies. */
function Probe() {
  const t = useT();
  const { formatNumber } = useFormatters();
  return <p>{`${useLocale()}|${t('common.close')}|${formatNumber(1234)}`}</p>;
}

/** Calls a hook and shows nothing. */
function Run({ hook }: { readonly hook: () => unknown }) {
  hook();
  return null;
}

test('the provider supplies the locale, the catalog and the formatters', () => {
  render(
    <I18nProvider>
      <Probe />
    </I18nProvider>,
  );
  expect(screen.getByText(`en|${messages['common.close']}|1,234`)).toBeInTheDocument();
});

test('the provider sets the lang of the document to its locale', () => {
  document.documentElement.lang = 'fr';
  render(
    <I18nProvider locale="en">
      <Probe />
    </I18nProvider>,
  );
  expect(document.documentElement.lang).toBe('en');
});

/** What `useT` and `useFormatters` returned in each render of `Run hook={useCollect}`. */
const seen: unknown[][] = [];
function useCollect() {
  seen.push([useT(), useFormatters()]);
}

test('what the hooks return is stable across renders, so it is safe in a dependency list', () => {
  seen.length = 0;
  const { rerender } = render(
    <I18nProvider>
      <Run hook={useCollect} />
    </I18nProvider>,
  );
  rerender(
    <I18nProvider>
      <Run hook={useCollect} />
    </I18nProvider>,
  );
  expect(seen.length).toBeGreaterThanOrEqual(2);
  expect(seen.at(-1)?.[0]).toBe(seen[0]?.[0]);
  expect(seen.at(-1)?.[1]).toBe(seen[0]?.[1]);
});

test.each([
  ['useT', () => useT()],
  ['useFormatters', () => useFormatters()],
  ['useLocale', () => useLocale()],
])('%s outside the provider fails loudly instead of showing nothing', (_name, hook) => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  expect(() => render(<Run hook={hook} />)).toThrow('Text and formatters need an I18nProvider above the component');
});
