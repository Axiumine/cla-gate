// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import type { ConfigIssue } from './config-issue.ts';

// Docker secrets arrive as files (E19-S02): for each secret variable `N` there is an `N_FILE` that names a file holding the
// value. The files are read once, synchronously, at start-up, before the environment is parsed, and the value goes into `N`,
// so the schema sees exactly what it would have seen had the operator written the value into `N`.

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Every secret variable of the server, in the order the operator guides list them (E19-S09): each one has an `N_FILE`
 * variant. `MIGRATION_DATABASE_URL` is read by the migration command only (`migrate-config.ts`), the others by the server.
 * A test walks the environment schema and fails when a field that produces a `Secret` is missing here, or when an entry
 * here has no field.
 * @internal Exported for the unit tests and the operator documentation tests (Knip ignores `@internal` exports in production mode).
 */
export const SECRET_VARIABLES = [
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_APP_PRIVATE_KEY_PREVIOUS',
  'GITHUB_WEBHOOK_SECRET',
  'GITHUB_WEBHOOK_SECRET_PREVIOUS',
  'GITHUB_CLIENT_SECRET',
  'SESSION_SECRET',
  'SETUP_TOKEN',
  'DATABASE_URL',
  'MIGRATION_DATABASE_URL',
] as const;

/** No credential is anywhere near this long (a 4096-bit RSA key in PEM is about 3.3 KiB); a bigger file is not one. */
function maxBytes(): number {
  return 64 * 1024;
}

/** What {@link resolveSecretFiles} makes of an environment. */
export interface ResolvedSecrets {
  /** The environment with every `N_FILE` read into `N`; the `N_FILE` entries stay as they were. */
  readonly env: Env;
  /** What went wrong, one issue per variable; empty when every file was read. */
  readonly issues: readonly ConfigIssue[];
  /** The secret variables (`N`) that have an issue, so the schema does not report them a second time. */
  readonly failed: ReadonlySet<string>;
}

/** The code of a system error (`ENOENT`, `EACCES`), or `UNKNOWN`. The message of the error is dropped: it may quote a path or a value. */
function systemCode(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  return typeof code === 'string' && /^[A-Z0-9_]{1,32}$/.test(code) ? code : 'UNKNOWN';
}

/** A path as it may appear on a line of stderr: control characters (a newline would forge a line) become `?`, and it is cut at 200. */
function printable(file: string): string {
  const clean = file.replaceAll(/\p{Cc}/gu, '?');
  return clean.length > 200 ? `${clean.slice(0, 200)}...` : clean;
}

/** The text of the file without the one trailing line break an editor or `echo` adds (`\r\n` or `\n`); everything else is kept. */
function withoutFinalLineBreak(text: string): string {
  if (text.endsWith('\r\n')) {
    return text.slice(0, -2);
  }
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

/** @returns the text of the file, or the rule that says why it cannot be used (never a piece of the content). */
function readSecretFile(file: string): { readonly text: string } | { readonly rule: string } {
  const tooLarge = { rule: 'file is larger than 64 KiB' };
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the operator's own N_FILE setting, read once at start-up
    const stats = fs.statSync(file);
    if (!stats.isFile()) {
      return { rule: `cannot read ${printable(file)} (${stats.isDirectory() ? 'EISDIR' : 'ENOTSUP'})` };
    }
    if (stats.size > maxBytes()) {
      return tooLarge;
    }
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the operator's own N_FILE setting, read once at start-up
    const content = fs.readFileSync(file);
    return content.length > maxBytes() ? tooLarge : { text: withoutFinalLineBreak(content.toString('utf8')) };
  } catch (error) {
    return { rule: `cannot read ${printable(file)} (${systemCode(error)})` };
  }
}

/** What one variable's file comes to: the issue when there is one, else the text to put into the variable (none: leave it as it is). */
function resolveOne(
  env: ReadonlyMap<string, string | undefined>,
  name: string,
): { readonly issue?: ConfigIssue; readonly text?: string } {
  const file = env.get(`${name}_FILE`) ?? '';
  if (file === '') {
    return {};
  }
  if ((env.get(name) ?? '') !== '') {
    return { issue: { variable: `${name}, ${name}_FILE`, rule: 'set only one' } };
  }
  const read = readSecretFile(file);
  if ('rule' in read) {
    return { issue: { variable: `${name}_FILE`, rule: read.rule } };
  }
  return read.text === '' ? {} : { text: read.text };
}

/**
 * Reads `N_FILE` into `N` for each name in `names`. An empty `N` or `N_FILE` counts as unset, and so does an empty file
 * (the compose stack keeps empty placeholder files for credentials that do not exist yet): then `N` stays as it was. A
 * symlink is followed. Setting both `N` and `N_FILE` is an error, and so is a file that cannot be read or is over 64 KiB;
 * the issue names the variable and the cause and never the content of the file.
 */
export function resolveSecretFiles(env: Env, names: readonly string[] = SECRET_VARIABLES): ResolvedSecrets {
  const given = new Map(Object.entries(env));
  const resolved = new Map(given);
  const issues: ConfigIssue[] = [];
  const failed = new Set<string>();
  for (const name of names) {
    const { issue, text } = resolveOne(given, name);
    if (issue !== undefined) {
      issues.push(issue);
      failed.add(name);
    } else if (text !== undefined) {
      resolved.set(name, text);
    }
  }
  return { env: Object.fromEntries(resolved), issues, failed };
}
