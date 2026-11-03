// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// The setup file of the `web` Vitest project (E17-S01), run before every test file. It is on the coverage exclusion list
// (`**/vitest.setup.ts`), and nothing else of src/web is.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { installResizeObserver, installScrollTo } from './layout.ts';
import { server } from './server.ts';
import { resetThemeEnvironment } from './theme.ts';

// jsdom does no layout and has no ResizeObserver, which Radix's primitives use (E17-S06), and its scrollTo only complains,
// which the router calls when it navigates (E17-S07).
installResizeObserver();
installScrollTo();

// A request without a handler fails (MSW 3 calls the option onUnhandledFrame): the app reaches the network only as a test says.
beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});

// Every test starts on a first visit on a light system: jsdom has no matchMedia, and the theme leaves a mark on <html> and
// in storage (E17-S05).
beforeEach(resetThemeEnvironment);

// Testing Library only cleans up by itself when Vitest globals are on; they are off here, so it is done explicitly.
afterEach(() => {
  cleanup();
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
