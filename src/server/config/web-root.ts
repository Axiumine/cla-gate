// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { z } from 'zod';

/**
 * Where `yarn build` puts the single-page app (E17-S03): `dist/web`, next to `dist/server`. This file is
 * `dist/server/config/web-root.js` once built, so the app is two directories up and one down.
 */
export const DEFAULT_WEB_ROOT = path.resolve(import.meta.dirname, '../../web');

/** `WEB_ROOT`: a non-empty directory path, made absolute against the working directory. A NUL byte can name no file. */
export const webRootField = z
  .string()
  .min(1)
  .refine((value) => !value.includes('\0'))
  .transform((value) => path.resolve(value));
