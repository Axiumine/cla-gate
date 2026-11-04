// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { exists, findOnPath, readText, symlink, writeExecutable } from '../ci/lib/test-support.ts';
import { makeRepo, tempDir } from '../code-caps/test-support.ts';

// What the tests of the operator stack (E19-S04) share: the compose file read as data, and a scratch checkout to run
// scripts/init-secrets.sh in.

export const ROOT = path.resolve(import.meta.dirname, '../..');

/** The default subnet of the stack's network and of the proxy it trusts. */
// eslint-disable-next-line sonarjs/no-hardcoded-ip -- the private range the operator stack uses by default, not an address to connect to
export const STACK_SUBNET = '172.30.30.0/24';

/** A compare function for `toSorted`, so that the order does not depend on the locale of the machine. */
export const byName = (a: string, b: string): number => a.localeCompare(b);

const serviceSchema = z.object({
  image: z.string().optional(),
  build: z.object({ context: z.string(), args: z.record(z.string(), z.string()) }).optional(),
  command: z.array(z.string()).optional(),
  restart: z.string().optional(),
  read_only: z.boolean().optional(),
  tmpfs: z.array(z.string()).optional(),
  cap_drop: z.array(z.string()).optional(),
  cap_add: z.array(z.string()).optional(),
  profiles: z.array(z.string()).optional(),
  security_opt: z.array(z.string()).optional(),
  init: z.boolean().optional(),
  stop_grace_period: z.string().optional(),
  environment: z.record(z.string(), z.string()).optional(),
  secrets: z.array(z.string()).optional(),
  volumes: z.array(z.string()).optional(),
  ports: z.array(z.string()).optional(),
  networks: z.array(z.string()).optional(),
  depends_on: z.record(z.string(), z.object({ condition: z.string() })).optional(),
  healthcheck: z.object({ test: z.array(z.string()) }).optional(),
});

const composeSchema = z.object({
  name: z.string(),
  services: z.record(z.string(), serviceSchema),
  networks: z.record(
    z.string(),
    z.object({
      internal: z.boolean().optional(),
      ipam: z.object({ config: z.array(z.object({ subnet: z.string() })) }).optional(),
    }),
  ),
  secrets: z.record(z.string(), z.object({ file: z.string() })),
  volumes: z.record(z.string(), z.null()),
});

export type Compose = z.output<typeof composeSchema>;
export type Service = z.output<typeof serviceSchema>;

/** The operator stack as data; the `<<` merge keys of the shared anchor are applied, as Compose applies them. */
export function readCompose(): Compose {
  return composeSchema.parse(parse(readText(path.join(ROOT, 'docker-compose.yml')), { merge: true }));
}

/** The service called `name`; a missing one fails the test that asked for it. */
export function serviceNamed(compose: Compose, name: string): Service {
  const found = new Map(Object.entries(compose.services)).get(name);
  if (found === undefined) {
    throw new Error(`docker-compose.yml has no service ${name}`);
  }
  return found;
}

/** How compose spells a variable with a default (`NAME:-default` between a dollar sign and braces), built so that no test string looks like an unfilled template. */
export function withDefault(name: string, fallback: string): string {
  return `\${${name}:-${fallback}}`;
}

/** How compose spells an optional prefix: `NAME` and a colon in front when `NAME` is set and not empty, nothing otherwise. */
export function withOptionalPrefix(name: string): string {
  return `\${${name}:+\${${name}}:}`;
}

/** The `NAME:-default` entries of an `environment:` block, as `NAME` to its default; any other form maps to `undefined`. */
export function defaultsOf(environment: Readonly<Record<string, string>>): Map<string, string | undefined> {
  return new Map(
    Object.entries(environment).map(([name, value]) => {
      const head = withDefault(name, '').slice(0, -1);
      const spelled = value.startsWith(head) && value.endsWith('}') && !value.slice(head.length, -1).includes('}');
      return [name, spelled ? value.slice(head.length, -1) : undefined];
    }),
  );
}

/** The names of the variables that compose interpolates in `text`: every `${NAME` (with or without a default or a check). */
export function interpolated(text: string): string[] {
  return [...new Set([...text.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((match) => match.slice(1).join('')))];
}

/** The `NAME=value` lines of a dotenv file (comments and blank lines are not assignments). */
export function assignments(text: string): Map<string, string> {
  return new Map(
    text
      .split('\n')
      .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
      .map((line): [string, string] => {
        const at = line.indexOf('=');
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
}

// ------------------------------------------------------------------------------------------------- init-secrets.sh

export const INIT_SCRIPT = path.join(ROOT, 'scripts/init-secrets.sh');

/** Every file the script creates under secrets/, in the order the stack lists them. */
export const GENERATED = ['db_admin_password', 'db_owner_password', 'db_app_password', 'session_secret', 'setup_token'];
export const DERIVED = ['database_url', 'migration_database_url'];
export const PLACEHOLDERS = [
  'github_app_private_key',
  'github_webhook_secret',
  'github_client_secret',
  'github_app_private_key_previous',
  'github_webhook_secret_previous',
];

/** What `sh -x` and the like are run with: the script is started as `sh <flags> scripts/init-secrets.sh`. */
interface InitRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface Checkout {
  readonly root: string;
  /** The directory the script is run from: not the checkout, so that a script that wrote relative to it would show. */
  readonly outside: string;
  /** secrets/ of the checkout: where the script puts the files. */
  readonly files: string;
  /** Runs the script (default `sh`) with `env` over the process environment; `cwd` defaults to a directory outside the checkout. */
  readonly run: (options?: {
    readonly shell?: readonly string[];
    readonly env?: Readonly<Record<string, string>>;
  }) => InitRun;
  /** What is under secrets/ (nothing when the directory does not exist). */
  readonly listing: () => string[];
  /** The content of secrets/`name`, line break included. */
  readonly read: (name: string) => string;
  /** Writes secrets/`name` (the directory is created when it is missing). */
  readonly write: (name: string, text: string) => void;
}

function entriesOf(directory: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: a path inside a temp directory
  return exists(directory) ? fs.readdirSync(directory) : [];
}

/** A scratch checkout: the script under scripts/, a copy of .env.example, and nothing else. Removed after the test. */
export function checkout(): Checkout {
  const root = tempDir();
  const outside = tempDir();
  makeRepo(root, { '.env.example': readText(path.join(ROOT, '.env.example')) });
  makeRepo(root, { 'scripts/init-secrets.sh': readText(INIT_SCRIPT) });
  const secrets = path.join(root, 'secrets');
  return {
    root,
    outside,
    files: secrets,
    run: ({ shell = ['sh'], env = {} } = {}) => {
      const [program = 'sh', ...flags] = shell;
      const result = spawnSync(findOnPath(program), [...flags, path.join(root, 'scripts/init-secrets.sh')], {
        cwd: outside,
        env: { ...process.env, ...env },
        input: '',
        encoding: 'utf8',
      });
      return { status: result.status, stdout: result.stdout, stderr: result.stderr };
    },
    listing: () => entriesOf(secrets),
    read: (name) => readText(path.join(secrets, name)),
    write: (name, text) => {
      makeRepo(root, { [`secrets/${name}`]: text });
    },
  };
}

/** Creates a directory (and its parents). */
export function makeDirectory(directory: string): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: a path inside a temp directory
  fs.mkdirSync(directory, { recursive: true });
}

/** Sets the permission bits of a file or directory. */
export function setMode(file: string, mode: number): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: a path inside a temp directory
  fs.chmodSync(file, mode);
}

/** Where a symbolic link points. */
export function linkTarget(file: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: a path inside a temp directory
  return fs.readlinkSync(file);
}

/** What a file looks like to `ls -l`: permission bits, size, modification time and inode, for "did anything change". */
export function fingerprint(file: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: a path inside a temp directory
  const stats = fs.statSync(file);
  return [(stats.mode & 0o777).toString(8), stats.size, stats.mtimeMs, stats.ino].join(' ');
}

/** The permission bits of a file or directory, in octal. */
export function modeOf(file: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: a path inside a temp directory
  return (fs.statSync(file).mode & 0o777).toString(8);
}

/** The tools the script runs besides its shell built-ins. A PATH with these and no `openssl` is a machine without it. */
const TOOLS = ['dirname', 'mkdir', 'chmod', 'ln', 'rm', 'cat', 'cp', 'dd', 'od', 'tr'];

/** A directory of links to the real tools except those in `omit`, and `openssl` only when it is given as a script text (a stub). */
export function toolbox(openssl?: string, omit: readonly string[] = []): string {
  const bin = path.join(tempDir(), 'bin');
  makeDirectory(bin);
  for (const tool of TOOLS.filter((name) => !omit.includes(name))) {
    symlink(findOnPath(tool), path.join(bin, tool));
  }
  if (openssl !== undefined) {
    writeExecutable(path.join(bin, 'openssl'), openssl);
  }
  return bin;
}

/**
 * A PATH like {@link toolbox}'s whose `chmod` first appends `<mode> <path>` of its last argument to `log`: the mode a file or
 * directory has at the moment the script changes it, which is what the umask of the script decided.
 */
export function chmodRecorder(log: string): string {
  const bin = toolbox(undefined, ['chmod']);
  const lines = [
    '#!/bin/sh',
    'for last; do :; done',
    `${findOnPath('stat')} -c '%a %n' -- "$last" >>'${log}'`,
    `exec ${findOnPath('chmod')} "$@"`,
    '',
  ];
  writeExecutable(path.join(bin, 'chmod'), lines.join('\n'));
  return bin;
}

// ------------------------------------------------------------------------------------------------- environment wiring

/** The names in `environment` that neither a non-secret field of the schema nor the `_FILE` of a secret explains. */
export function unknownNames(
  environment: Readonly<Record<string, string>>,
  fields: readonly string[],
  secrets: readonly string[],
): string[] {
  const known = new Set([
    ...fields.filter((field) => !secrets.includes(field)),
    ...secrets.map((name) => `${name}_FILE`),
  ]);
  return Object.keys(environment).filter((name) => !known.has(name));
}

/** The non-secret fields that are neither passed as `${NAME:-default}` in `environment` nor listed in `exempt`. */
export function notPassed(
  environment: Readonly<Record<string, string>>,
  fields: readonly string[],
  secrets: readonly string[],
  exempt: ReadonlySet<string>,
): string[] {
  const defaults = defaultsOf(environment);
  return fields.filter((field) => !secrets.includes(field) && !exempt.has(field) && defaults.get(field) === undefined);
}

/**
 * The environment a container gets when compose has read `dotenv` (an empty value counts as unset, as `:-` treats it): each
 * `${NAME:-default}` entry is the dotenv value or the default, and each `<NAME>_FILE` entry points into `secretsDirectory`
 * instead of /run/secrets.
 */
export function effectiveEnvironment(
  environment: Readonly<Record<string, string>>,
  dotenv: ReadonlyMap<string, string>,
  secretsDirectory: string,
): Record<string, string> {
  const defaults = defaultsOf(environment);
  return Object.fromEntries(
    Object.entries(environment).map(([name, value]) => {
      const given = dotenv.get(name) ?? '';
      return [
        name,
        name.endsWith('_FILE') ? value.replace('/run/secrets', secretsDirectory) : given || (defaults.get(name) ?? ''),
      ];
    }),
  );
}
