// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { DATA_EXPORT_PATH, dataExportRoute, dataExportSchema } from './data-export.ts';

// E18-S03: the descriptor the "my signatures" screen calls the export by.

test('the export is a GET of the path of E16-S06 and takes nothing: no params, no query and no body, because nobody can be named', () => {
  expect(dataExportRoute.method).toBe('GET');
  expect(dataExportRoute.path).toBe(DATA_EXPORT_PATH);
  expect(dataExportRoute.name).toBe('GET /api/me/export');
  expect('params' in dataExportRoute).toBe(false);
  expect('query' in dataExportRoute).toBe(false);
  expect('body' in dataExportRoute).toBe(false);
});

test('its one success answer is the export document of the contract', () => {
  expect(dataExportRoute.responses).toEqual({ 200: dataExportSchema });
});
