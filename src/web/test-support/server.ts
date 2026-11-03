// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { setupServer } from 'msw/node';

/**
 * The one MSW server of the web tests (E17-S01). The setup file (vitest.setup.ts) starts it for every test file, refuses
 * any request that has no handler and removes the handlers a test added; a test adds its own with `server.use(...)`.
 */
export const server = setupServer();
