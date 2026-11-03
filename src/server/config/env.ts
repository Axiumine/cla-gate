// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { z } from 'zod';
import type { SweepInterval } from '../domain/sweep.ts';
import { envSchema, type ValidEnv } from './env-schema.ts';
import { type GithubConfig, toGithubConfig } from './github-config.ts';
import type { Secret } from './secret.ts';
import type { TrustProxy } from './trust-proxy.ts';

/** Everything the server reads from the environment, validated and typed (see docs/configuration.md). */
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
  /** How long a session lives (E10-S01), in seconds; idle is never above absolute and neither is below 300. */
  readonly session: { readonly idleSeconds: number; readonly absoluteSeconds: number };
  /** How many jobs of one queue run at once in this process (E07-S03), 1 to 32. */
  readonly workerConcurrency: number;
  /** Minutes between two reconciliation sweeps (E07-S08): 5, 10, 15, 20, 30 or 60, or 0 for none. */
  readonly sweepIntervalMinutes: SweepInterval;
  readonly github: GithubConfig;
  /** The directory the single-page app is served from (E17-S03): absolute, `dist/web` unless `WEB_ROOT` says otherwise. */
  readonly webRoot: string;
  /** Where the corresponding source of the running version is (E17-S09, AGPL section 13): the repository and, when the build knows it, the commit. */
  readonly source: { readonly url: string; readonly commit: string | null };
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
    session: { idleSeconds: env.SESSION_IDLE_SECONDS, absoluteSeconds: env.SESSION_ABSOLUTE_SECONDS },
    workerConcurrency: env.WORKER_CONCURRENCY,
    sweepIntervalMinutes: env.SWEEP_INTERVAL_MINUTES,
    github: toGithubConfig(env),
    webRoot: env.WEB_ROOT,
    source: { url: env.SOURCE_URL, commit: env.SOURCE_COMMIT },
  };
}

type Env = Readonly<Record<string, string | undefined>>;

/** An empty variable (`PORT=` in a compose file) counts as unset. A variable that is undefined already does (zod). */
function withoutEmpty(env: Env): Env {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
}

function variableNames(error: z.ZodError): string[] {
  // Stryker disable next-line ConditionalExpression: a type guard for the compiler; the first path element of every issue of envSchema is a variable name
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
