// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { isHttpOrigin } from '../../shared/sign-link.ts';
import { SWEEP_INTERVALS } from '../domain/sweep.ts';
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
export const secretField = z
  .string()
  .min(1)
  .transform((value) => new Secret(value));
/** A `postgres://` or `postgresql://` connection string; it carries a password, hence a Secret. */
export const databaseUrlField = z
  .string()
  .refine(isPostgresUrl)
  .transform((value) => new Secret(value));
/**
 * `scheme://host[:port]` with nothing after it, normalised, with a host the sign link of a pull request can be built on
 * (E09-S03): letters, digits, hyphens and dots, or an IPv6 literal. The origin is the base of every sign link, so one that
 * would fail there is refused at start-up and never reaches a failing pull request.
 */
export const originField = z
  .string()
  .refine(isOrigin)
  .transform((value) => new URL(value).origin)
  .refine(isHttpOrigin);
/** A TCP port, 0 to 65535. */
export const portField = z
  .string()
  .regex(/^\d{1,5}$/)
  .transform(Number)
  .pipe(z.number().max(65_535));

/** How many jobs of one queue run at once (E07-S03): a whole number from 1 to 32, no sign, no leading zero, no spaces. */
export const workerConcurrencyField = z
  .string()
  .regex(/^[1-9]\d?$/)
  .transform(Number)
  .pipe(z.number().max(32));

/**
 * The minutes between two sweeps (E07-S08): exactly one of `SWEEP_INTERVALS` (0, 5, 10, 15, 20, 30, 60), written as plain
 * digits without a sign, a leading zero or spaces. Anything else is a `ConfigError`.
 */
export const sweepIntervalField = z
  .string()
  .regex(/^(?:0|[1-9]\d?)$/)
  .transform(Number)
  .pipe(z.literal(SWEEP_INTERVALS));

/** @returns the parsed setting; for text that is not a setting it records an issue and returns `z.NEVER`. */
function toTrustProxy(value: string, ctx: z.core.$RefinementCtx<string>): TrustProxy {
  const parsed = parseTrustProxy(value);
  if (parsed === undefined) {
    // Stryker disable next-line StringLiteral: only the variable name of an issue is ever reported, never its message
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

/** The one-time token that unlocks the first-run setup (E19-S02): at least 32 characters, a secret. */
export const setupTokenField = z
  .string()
  .min(32)
  .transform((value) => new Secret(value));
