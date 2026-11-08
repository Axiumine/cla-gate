// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import type { GithubId } from '../../shared/github-id.ts';
import { parseAllowedAccountIds } from './allowed-accounts.ts';
import type { ConfigIssue } from './config-issue.ts';
import { secretField } from './env-fields.ts';
import { type GitHubPrivateKey, parseGitHubPrivateKey } from './github-key.ts';
import { parseOperatorGithubIds } from './operator-ids.ts';
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

/**
 * @returns the ids; undefined for blank text (the variable is then unset, E11-S08); for text that is not a list of user ids
 * it records an issue and returns `z.NEVER`.
 */
function toOperatorIds(value: string, ctx: z.core.$RefinementCtx<string>): readonly GithubId[] | undefined {
  const ids = parseOperatorGithubIds(value);
  if (ids === undefined) {
    ctx.issues.push({ code: 'custom', message: 'invalid', input: value });
    return z.NEVER;
  }
  return ids.length === 0 ? undefined : ids;
}
/** The numeric ids of the instance operators (E11-S08): see {@link parseOperatorGithubIds}. */
const operatorIdsField = z.string().transform(toOperatorIds);

/** A webhook secret: at least 16 characters, as a Secret (E06-S01). GitHub's own advice is a long random string. */
function webhookSecretField() {
  return z
    .string()
    .min(16)
    .transform((value) => new Secret(value));
}

/**
 * The GitHub App settings. Each is optional here: production needs all five of the App id, the key, the webhook secret and
 * the client id and secret, or none of them (`resolveMode`, mode.ts). The previous key and the previous webhook secret are
 * the ones kept during a rotation (E05-S02, E06-S01). The client id and secret are the App's OAuth credentials for the login (E10-S05); production
 * requires them through `authProblems` (auth-fields.ts), which also owns the session secret. Built on each call and not once at
 * import, so that the mutation gate's tests exercise these rules (see "Module-level code" in docs/quality-gates.md); the key order
 * is the order in which the issues of a failed parse are reported.
 */
export function githubFields() {
  return {
    GITHUB_APP_ID: z
      .string()
      .regex(/^\d{1,20}$/)
      .optional(),
    GITHUB_APP_PRIVATE_KEY: privateKeyField.optional(),
    GITHUB_APP_PRIVATE_KEY_PREVIOUS: privateKeyField.optional(),
    GITHUB_ALLOWED_ACCOUNT_IDS: allowedAccountIdsField.optional(),
    OPERATOR_GITHUB_IDS: operatorIdsField.optional(),
    GITHUB_WEBHOOK_SECRET: webhookSecretField().optional(),
    GITHUB_WEBHOOK_SECRET_PREVIOUS: webhookSecretField().optional(),
    GITHUB_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_CLIENT_SECRET: secretField().optional(),
  };
}

/**
 * The text of a secret that parsed. The cross-field rules run over the partly parsed environment, where a field that
 * failed its own check still holds its raw input (not a {@link Secret}): such a field has no text to compare, and is
 * reported by name already.
 */
function secretText(value: Secret | undefined): string | undefined {
  return value instanceof Secret ? value.reveal() : undefined;
}

export type GithubVariables = z.output<z.ZodObject<ReturnType<typeof githubFields>>>;

/**
 * The cross-field rules of the GitHub settings: a previous key or webhook secret that is the current one again is a rotation
 * that rotates nothing. Keys are compared by fingerprint, so one key in PKCS#1 and in PKCS#8, or with escaped newlines, is
 * still the same key. Which of the settings production cannot start without is decided by `resolveMode` (mode.ts): all five
 * App variables, or none and a setup token.
 */
export function githubProblems(env: GithubVariables): readonly ConfigIssue[] {
  const problems: ConfigIssue[] = [];
  const current = env.GITHUB_APP_PRIVATE_KEY?.fingerprint;
  if (current !== undefined && current === env.GITHUB_APP_PRIVATE_KEY_PREVIOUS?.fingerprint) {
    problems.push({
      variable: 'GITHUB_APP_PRIVATE_KEY_PREVIOUS',
      rule: 'must be a different key from GITHUB_APP_PRIVATE_KEY (a rotation keeps the old key here)',
    });
  }
  const secret = secretText(env.GITHUB_WEBHOOK_SECRET);
  if (secret !== undefined && secret === secretText(env.GITHUB_WEBHOOK_SECRET_PREVIOUS)) {
    problems.push({
      variable: 'GITHUB_WEBHOOK_SECRET_PREVIOUS',
      rule: 'must differ from GITHUB_WEBHOOK_SECRET (a rotation keeps the old secret here)',
    });
  }
  return problems;
}
