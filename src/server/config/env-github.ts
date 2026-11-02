// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import type { GithubId } from '../../shared/github-id.ts';
import { parseAllowedAccountIds } from './allowed-accounts.ts';
import { secretField } from './env-fields.ts';
import { type GitHubPrivateKey, parseGitHubPrivateKey } from './github-key.ts';
import { Secret } from './secret.ts';

// The GitHub App part of the environment schema in env-schema.ts: the variables and the rules that tie them together.
// The settings the rest of the server reads (`AppConfig.github`) are in github-config.ts. Split from env-fields.ts to keep
// the files under the FTA cap.

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

/** A webhook secret: at least 16 characters, as a Secret (E06-S01). GitHub's own advice is a long random string. */
const webhookSecretField = z
  .string()
  .min(16)
  .transform((value) => new Secret(value));

/**
 * The GitHub App settings. The App id, the key and the webhook secret are optional here and required in production by
 * {@link githubProblems}; the previous key and the previous webhook secret are the ones kept during a rotation
 * (E05-S02, E06-S01). The client id and secret stay placeholders for the slices that use them.
 */
export const githubFields = {
  GITHUB_APP_ID: z
    .string()
    .regex(/^\d{1,20}$/)
    .optional(),
  GITHUB_APP_PRIVATE_KEY: privateKeyField.optional(),
  GITHUB_APP_PRIVATE_KEY_PREVIOUS: privateKeyField.optional(),
  GITHUB_ALLOWED_ACCOUNT_IDS: allowedAccountIdsField.optional(),
  GITHUB_WEBHOOK_SECRET: webhookSecretField.optional(),
  GITHUB_WEBHOOK_SECRET_PREVIOUS: webhookSecretField.optional(),
  GITHUB_CLIENT_ID: z.string().min(1).optional(),
  GITHUB_CLIENT_SECRET: secretField.optional(),
};

/**
 * The text of a secret that parsed. The cross-field rules run over the partly parsed environment, where a field that
 * failed its own check still holds its raw input (not a {@link Secret}): such a field has no text to compare, and is
 * reported by name already.
 */
function secretText(value: Secret | undefined): string | undefined {
  return value instanceof Secret ? value.reveal() : undefined;
}

export type GithubVariables = z.output<z.ZodObject<typeof githubFields>>;
type GithubEnv = GithubVariables & { readonly NODE_ENV: string };

/** The GitHub settings production cannot start without (elsewhere the adapter is not built, or a delivery is refused). */
function productionProblems(env: GithubEnv): readonly string[] {
  if (env.NODE_ENV !== 'production') {
    return [];
  }
  const required = [
    ['GITHUB_APP_ID', env.GITHUB_APP_ID],
    ['GITHUB_APP_PRIVATE_KEY', env.GITHUB_APP_PRIVATE_KEY],
    ['GITHUB_WEBHOOK_SECRET', env.GITHUB_WEBHOOK_SECRET],
  ] as const;
  return required.filter(([, value]) => value === undefined).map(([name]) => name);
}

/** A previous key or webhook secret that is the current one again: a rotation that rotates nothing. */
function rotationProblems(env: GithubEnv): readonly string[] {
  const problems: string[] = [];
  const current = env.GITHUB_APP_PRIVATE_KEY?.fingerprint;
  if (current !== undefined && current === env.GITHUB_APP_PRIVATE_KEY_PREVIOUS?.fingerprint) {
    problems.push('GITHUB_APP_PRIVATE_KEY_PREVIOUS');
  }
  const secret = secretText(env.GITHUB_WEBHOOK_SECRET);
  if (secret !== undefined && secret === secretText(env.GITHUB_WEBHOOK_SECRET_PREVIOUS)) {
    problems.push('GITHUB_WEBHOOK_SECRET_PREVIOUS');
  }
  return problems;
}

/**
 * The cross-field rules of the GitHub settings, by variable name: production needs the App id, the signing key and the
 * webhook secret (elsewhere the GitHub adapter is simply not built without the first two, and a delivery is refused
 * without the third), and a previous key or webhook secret must differ from the current one. Keys are compared by
 * fingerprint, so one key in PKCS#1 and in PKCS#8, or with escaped newlines, is still the same key.
 */
export function githubProblems(env: GithubEnv): readonly string[] {
  return [...productionProblems(env), ...rotationProblems(env)];
}
