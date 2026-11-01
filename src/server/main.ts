// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
//
// Entry point of `yarn start` / `yarn dev` (`node src/server/main.ts`, or `node dist/server/main.js` once built).
// Logic-free on purpose: everything lives in boot.ts and is tested there. The handle is exported for the boot test.
import process from 'node:process';
import { boot } from './boot.ts';

export const server = await boot({ env: process.env, signals: process });
