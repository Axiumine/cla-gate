// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

export type Env = Readonly<Record<string, string | undefined>>;

/** `record[key]` for a key that is not a literal in the source, without the object-injection pattern that ESLint rejects. */
export function lookup<T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  return new Map(Object.entries(record ?? {})).get(key);
}

/** An environment variable; unset and empty are the same thing here. */
export function variable(env: Env, name: string): string {
  return lookup(env, name) ?? '';
}
