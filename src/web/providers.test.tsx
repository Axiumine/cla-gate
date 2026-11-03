// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQueryClient } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { createQueryClient } from './api/query-client.ts';
import { useT } from './i18n/index.ts';
import { AppProviders } from './providers.tsx';

function Probe() {
  const t = useT();
  return <p>{t('app.name')}</p>;
}

const SEEDED = ['seeded'];

function Seeded() {
  return <p>{String(useQueryClient().getQueryData(SEEDED))}</p>;
}

test('the providers give the screens the query client they were handed and the message catalog', () => {
  render(
    <AppProviders queryClient={createQueryClient()}>
      <Probe />
    </AppProviders>,
  );
  expect(screen.getByText('CLA Platform')).toBeInTheDocument();
});

test('the client of the providers is the very object that was passed: what a test seeded in it is what the screens read', () => {
  const queryClient = createQueryClient();
  queryClient.setQueryData(SEEDED, 'from the test');
  render(
    <AppProviders queryClient={queryClient}>
      <Seeded />
    </AppProviders>,
  );
  expect(screen.getByText('from the test')).toBeInTheDocument();
});
