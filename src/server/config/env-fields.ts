// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { Secret } from './secret.ts';
import { parseTrustProxy, type TrustProxy } from './trust-proxy.ts';

// The building blocks of the environment schema in env.ts: one zod schema per kind of variable.

function isPostgresUrl(value: string): boolean {
  return URL.canParse(value) && ['postgres:', 'postgresql:'].includes(new URL(value).protocol);
}

function isOrigin(value: string): boolean {
  if (!URL.canParse(value)) {
    return false;
  }
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && url.pathname === '/' && url.search === '' && url.hash === '';
}

/** A non-empty secret value. */
const secretField = z
  .string()
  .min(1)
  .transform((value) => new Secret(value));
/** A `postgres://` or `postgresql://` connection string; it carries a password, hence a Secret. */
export const databaseUrlField = z
  .string()
  .refine(isPostgresUrl)
  .transform((value) => new Secret(value));
/** `scheme://host[:port]` with nothing after it, normalised. */
export const originField = z
  .string()
  .refine(isOrigin)
  .transform((value) => new URL(value).origin);
/** A TCP port, 0 to 65535. */
export const portField = z
  .string()
  .regex(/^\d{1,5}$/)
  .transform(Number)
  .pipe(z.number().max(65_535));

/** @returns the parsed setting; for text that is not a setting it records an issue and returns `z.NEVER`. */
function toTrustProxy(value: string, ctx: z.core.$RefinementCtx<string>): TrustProxy {
  const parsed = parseTrustProxy(value);
  if (parsed === undefined) {
    ctx.issues.push({ code: 'custom', message: 'invalid', input: value });
    return z.NEVER;
  }
  return parsed;
}
/** See {@link parseTrustProxy}. */
export const trustProxyField = z.string().transform(toTrustProxy);

/** A session secret is a key: at least 32 characters. */
export const sessionSecretField = z
  .string()
  .min(32)
  .transform((value) => new Secret(value));

/** Placeholders for the GitHub App: later slices make them required. */
export const githubFields = {
  GITHUB_APP_ID: z
    .string()
    .regex(/^\d{1,20}$/)
    .optional(),
  GITHUB_APP_PRIVATE_KEY: secretField.optional(),
  GITHUB_WEBHOOK_SECRET: secretField.optional(),
  GITHUB_CLIENT_ID: z.string().min(1).optional(),
  GITHUB_CLIENT_SECRET: secretField.optional(),
};
