// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import type { GithubId } from '../../shared/github-id.ts';
import { parseAllowedAccountIds } from './allowed-accounts.ts';
import { type GitHubPrivateKey, parseGitHubPrivateKey } from './github-key.ts';
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

/** @returns the key; for text that is not an RSA private key of 2048 bits or more it records an issue and returns `z.NEVER`. */
function toPrivateKey(value: string, ctx: z.core.$RefinementCtx<string>): GitHubPrivateKey {
  const key = parseGitHubPrivateKey(value);
  if (key === undefined) {
    // The input stays out of the issue: the text is key material.
    ctx.issues.push({ code: 'custom', message: 'invalid', input: '' });
    return z.NEVER;
  }
  return key;
}
/** A GitHub App private key (PEM, real or escaped newlines): see {@link parseGitHubPrivateKey}. */
const privateKeyField = z.string().transform(toPrivateKey);

/** @returns the ids; for text that is not a list of account ids it records an issue and returns `z.NEVER`. */
function toAllowedAccountIds(value: string, ctx: z.core.$RefinementCtx<string>): readonly GithubId[] {
  const ids = parseAllowedAccountIds(value);
  if (ids === undefined) {
    ctx.issues.push({ code: 'custom', message: 'invalid', input: value });
    return z.NEVER;
  }
  return ids;
}
/** The numeric account ids the instance serves besides the App owner's: see {@link parseAllowedAccountIds}. */
const allowedAccountIdsField = z.string().transform(toAllowedAccountIds);

/**
 * The GitHub App settings. The App id and the key are optional here and required in production by
 * {@link githubProblems}; the previous key is the one kept during rotation (E05-S02). The webhook and client secrets
 * stay placeholders for the slices that use them.
 */
export const githubFields = {
  GITHUB_APP_ID: z
    .string()
    .regex(/^\d{1,20}$/)
    .optional(),
  GITHUB_APP_PRIVATE_KEY: privateKeyField.optional(),
  GITHUB_APP_PRIVATE_KEY_PREVIOUS: privateKeyField.optional(),
  GITHUB_ALLOWED_ACCOUNT_IDS: allowedAccountIdsField.optional(),
  GITHUB_WEBHOOK_SECRET: secretField.optional(),
  GITHUB_CLIENT_ID: z.string().min(1).optional(),
  GITHUB_CLIENT_SECRET: secretField.optional(),
};

type GithubEnv = z.output<z.ZodObject<typeof githubFields>> & { readonly NODE_ENV: string };

/**
 * The cross-field rules of the GitHub settings, by variable name: production needs the App id and the signing key
 * (elsewhere the GitHub adapter is simply not built without them), and the previous key must be a different key from
 * the current one. Keys are compared by fingerprint, so one key in PKCS#1 and in PKCS#8, or with escaped newlines, is
 * still the same key.
 */
export function githubProblems(env: GithubEnv): readonly string[] {
  const problems: string[] = [];
  if (env.NODE_ENV === 'production' && env.GITHUB_APP_ID === undefined) {
    problems.push('GITHUB_APP_ID');
  }
  if (env.NODE_ENV === 'production' && env.GITHUB_APP_PRIVATE_KEY === undefined) {
    problems.push('GITHUB_APP_PRIVATE_KEY');
  }
  const current = env.GITHUB_APP_PRIVATE_KEY?.fingerprint;
  if (current !== undefined && current === env.GITHUB_APP_PRIVATE_KEY_PREVIOUS?.fingerprint) {
    problems.push('GITHUB_APP_PRIVATE_KEY_PREVIOUS');
  }
  return problems;
}
