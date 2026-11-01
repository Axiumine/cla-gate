// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';

/** `GET /healthz`: the process is up. Never touches the database. */
export const healthResponseSchema = z.object({ status: z.literal('ok') });

/** `GET /readyz` when the database answered. */
export const readyResponseSchema = z.object({ status: z.literal('ready') });

/** `GET /readyz` when it did not (HTTP 503). Deliberately says nothing about why. */
export const unavailableResponseSchema = z.object({ status: z.literal('unavailable') });
