// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { z } from 'zod';
import { databaseUrlField } from './env-fields.ts';
import { envSchema, type ValidEnv } from './env-schema.ts';
import type { Secret } from './secret.ts';
import type { TrustProxy } from './trust-proxy.ts';

/** Everything the server reads from the environment, validated and typed (see the Configuration table in README.md). */
export interface AppConfig {
  readonly nodeEnv: ValidEnv['NODE_ENV'];
  readonly host: string;
  readonly port: number;
  readonly logLevel: ValidEnv['LOG_LEVEL'];
  readonly databaseUrl: Secret;
  /** Origin the public reaches the app on, without a trailing slash. */
  readonly publicBaseUrl: string;
  readonly trustProxy: TrustProxy;
  readonly sessionSecret: Secret | undefined;
  /** Placeholders: later slices make these required. */
  readonly github: {
    readonly appId: string | undefined;
    readonly privateKey: Secret | undefined;
    readonly webhookSecret: Secret | undefined;
    readonly clientId: string | undefined;
    readonly clientSecret: Secret | undefined;
  };
}

/** Thrown for an invalid environment. Carries variable NAMES only: a value must never reach an error message or log. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
  readonly variables: readonly string[];

  constructor(variables: readonly string[]) {
    super(`Invalid environment configuration: ${variables.join(', ')}`);
    this.variables = variables;
  }
}

function toAppConfig(env: ValidEnv): AppConfig {
  return {
    nodeEnv: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL,
    publicBaseUrl: env.PUBLIC_BASE_URL ?? `http://localhost:${env.PORT}`,
    trustProxy: env.TRUST_PROXY,
    sessionSecret: env.SESSION_SECRET,
    github: {
      appId: env.GITHUB_APP_ID,
      privateKey: env.GITHUB_APP_PRIVATE_KEY,
      webhookSecret: env.GITHUB_WEBHOOK_SECRET,
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    },
  };
}

type Env = Readonly<Record<string, string | undefined>>;

/** An empty variable (`PORT=` in a compose file) counts as unset. */
function withoutEmpty(env: Env): Env {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined && value !== ''));
}

function variableNames(error: z.ZodError): string[] {
  const names = error.issues.map((issue) => issue.path[0]).filter((key): key is string => typeof key === 'string');
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

/** Validates `env` or throws a {@link ConfigError} naming every invalid variable. */
export function loadConfig(env: Env): AppConfig {
  const result = envSchema.safeParse(withoutEmpty(env));
  if (!result.success) {
    throw new ConfigError(variableNames(result.error));
  }
  return toAppConfig(result.data);
}

/**
 * What `yarn db:migrate` needs: the owner connection. Migrations create tables, so they cannot run as the
 * unprivileged runtime role in `DATABASE_URL`; `MIGRATION_DATABASE_URL` wins when set. Outside production it may be
 * left out and the migration falls back to `DATABASE_URL` (a single-role development database); in production it is
 * required, because tables created by the runtime role would be owned by it, and an owner can disable the triggers
 * that keep the signatures immutable (CLAUDE.md, hard rule 5).
 */
export function loadMigrateConfig(env: Env): { readonly databaseUrl: Secret } {
  const owner = env['MIGRATION_DATABASE_URL'] ?? '';
  const useOwner = owner !== '';
  if (!useOwner && env['NODE_ENV'] === 'production') {
    throw new ConfigError(['MIGRATION_DATABASE_URL']);
  }
  const name = useOwner ? 'MIGRATION_DATABASE_URL' : 'DATABASE_URL';
  const result = databaseUrlField.safeParse(useOwner ? owner : env['DATABASE_URL']);
  if (!result.success) {
    throw new ConfigError([name]);
  }
  return { databaseUrl: result.data };
}
