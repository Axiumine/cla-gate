// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// The setup file of the `web` Vitest project (E17-S01), run before every test file. It is on the coverage exclusion list
// with the MSW handler files, and nothing else of src/web is.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './server.ts';

// A request without a handler fails (MSW 3 calls the option onUnhandledFrame): the app reaches the network only as a test says.
beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});

// Testing Library only cleans up by itself when Vitest globals are on; they are off here, so it is done explicitly.
afterEach(() => {
  cleanup();
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
