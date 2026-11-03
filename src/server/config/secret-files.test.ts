// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import { resolveSecretFiles } from './secret-files.ts';
import { secretDirectory } from './secret-fixture/test-support.ts';

// E19-S02: `N_FILE` names a file that holds the value of `N`. The file is read once, a trailing line break is dropped, an
// empty file or variable counts as unset, and every failure names the variable and the cause and never the content.

afterEach(() => {
  vi.restoreAllMocks();
});

const NAME = 'SESSION_SECRET';
const ONLY = [NAME];

/** The value `N` ends up with after `N_FILE` is read from a file that holds `content`. */
function valueFromFile(content: string): string | undefined {
  const files = secretDirectory();
  return resolveSecretFiles({ SESSION_SECRET_FILE: files.write('value', content) }, ONLY).env['SESSION_SECRET'];
}

test('the value of N is the content of N_FILE', () => {
  const files = secretDirectory();
  const resolved = resolveSecretFiles({ SESSION_SECRET_FILE: files.write('value', 'abc-123') }, ONLY);
  expect(resolved).toMatchObject({ issues: [], failed: new Set() });
  expect(resolved.env['SESSION_SECRET']).toBe('abc-123');
});

test.each([
  ['no line break', 'value', 'value'],
  ['one LF', 'value\n', 'value'],
  ['one CRLF', 'value\r\n', 'value'],
  ['two LF: only one is removed', 'value\n\n', 'value\n'],
  ['two CRLF: only one is removed', 'value\r\n\r\n', 'value\r\n'],
  ['a CR alone is not a line break', 'value\r', 'value\r'],
  ['an LF before a CR is kept', 'value\n\r', 'value\n\r'],
  ['spaces and tabs are kept', '  value\t \n', '  value\t '],
  ['a line break inside is kept', 'line one\nline two\n', 'line one\nline two'],
  ['a PEM keeps its line breaks', '-----BEGIN-----\nAAAA\n-----END-----\n', '-----BEGIN-----\nAAAA\n-----END-----'],
])('a file with %s', (_label, content, expected) => {
  expect(valueFromFile(content)).toBe(expected);
});

test.each([
  ['an empty file', ''],
  ['a file with one LF only', '\n'],
  ['a file with one CRLF only', '\r\n'],
])('%s is a placeholder: N stays unset and nothing is reported', (_label, content) => {
  const files = secretDirectory();
  const resolved = resolveSecretFiles({ SESSION_SECRET_FILE: files.write('value', content) }, ONLY);
  expect(resolved.issues).toEqual([]);
  expect(resolved.env['SESSION_SECRET']).toBeUndefined();
});

test('an empty N is read from the file', () => {
  const files = secretDirectory();
  const full = files.write('full', 'from-file\n');
  expect(resolveSecretFiles({ SESSION_SECRET: '', SESSION_SECRET_FILE: full }, ONLY).env['SESSION_SECRET']).toBe(
    'from-file',
  );
});

test('an empty N_FILE counts as unset: N is used as it is', () => {
  const resolved = resolveSecretFiles({ SESSION_SECRET: 'direct', SESSION_SECRET_FILE: '' }, ONLY);
  expect(resolved).toMatchObject({ issues: [], env: { SESSION_SECRET: 'direct' } });
});

test('both N and N_FILE set is one issue naming both, whatever the file holds, and the file is not read', () => {
  const resolved = resolveSecretFiles({ SESSION_SECRET: 'direct', SESSION_SECRET_FILE: '/nonexistent/anywhere' }, ONLY);
  expect(resolved.issues).toEqual([{ variable: 'SESSION_SECRET, SESSION_SECRET_FILE', rule: 'set only one' }]);
  expect(resolved.failed).toEqual(new Set([NAME]));
  expect(resolved.env['SESSION_SECRET']).toBe('direct');
});

test('a missing file is `N_FILE: cannot read <path> (ENOENT)`', () => {
  const files = secretDirectory();
  const missing = files.at('absent');
  const resolved = resolveSecretFiles({ SESSION_SECRET_FILE: missing }, ONLY);
  expect(resolved.issues).toEqual([{ variable: 'SESSION_SECRET_FILE', rule: `cannot read ${missing} (ENOENT)` }]);
  expect(resolved.failed).toEqual(new Set([NAME]));
  expect(resolved.env['SESSION_SECRET']).toBeUndefined();
});

test('a directory is `cannot read <path> (EISDIR)`', () => {
  const files = secretDirectory();
  const resolved = resolveSecretFiles({ SESSION_SECRET_FILE: files.root }, ONLY);
  expect(resolved.issues).toEqual([{ variable: 'SESSION_SECRET_FILE', rule: `cannot read ${files.root} (EISDIR)` }]);
});

test('a file that is neither a regular file nor a directory is `cannot read <path> (ENOTSUP)`', () => {
  const resolved = resolveSecretFiles({ SESSION_SECRET_FILE: '/dev/null' }, ONLY);
  expect(resolved.issues).toEqual([{ variable: 'SESSION_SECRET_FILE', rule: 'cannot read /dev/null (ENOTSUP)' }]);
});

test('a symbolic link is followed, a link to nothing is a missing file', () => {
  const files = secretDirectory();
  const target = files.write('target', 'through-a-link\n');
  const resolved = resolveSecretFiles({ SESSION_SECRET_FILE: files.link('good', target) }, ONLY);
  expect(resolved.env['SESSION_SECRET']).toBe('through-a-link');
  const dangling = files.link('dangling', files.at('nowhere'));
  expect(resolveSecretFiles({ SESSION_SECRET_FILE: dangling }, ONLY).issues).toEqual([
    { variable: 'SESSION_SECRET_FILE', rule: `cannot read ${dangling} (ENOENT)` },
  ]);
});

test('a file the process may not read is `cannot read <path> (EACCES)`, with the code of the error and never its message', () => {
  const files = secretDirectory();
  const file = files.write('locked', 'LEAKCANARY-locked');
  const denied = Object.assign(new Error(`EACCES: permission denied, open '${file}' LEAKCANARY`), { code: 'EACCES' });
  vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
    throw denied;
  });
  const resolved = resolveSecretFiles({ SESSION_SECRET_FILE: file }, ONLY);
  expect(resolved.issues).toEqual([{ variable: 'SESSION_SECRET_FILE', rule: `cannot read ${file} (EACCES)` }]);
  expect(JSON.stringify(resolved.issues)).not.toContain('LEAKCANARY');
});

test.each([
  ['an error without a code', new Error('boom')],
  ['an error with a code that is not a code', Object.assign(new Error('boom'), { code: 'not a code!' })],
  ['an error with a numeric code', Object.assign(new Error('boom'), { code: 13 })],
  ['an error with a code that is too long', Object.assign(new Error('boom'), { code: 'E'.repeat(33) })],
  ['an error with a lower case code', Object.assign(new Error('boom'), { code: 'eacces' })],
  ['something that is not an object', 'boom'],
  ['null', null],
])('%s is `UNKNOWN`', (_label, thrown) => {
  const files = secretDirectory();
  const file = files.write('odd', 'x');
  vi.spyOn(fs, 'statSync').mockImplementationOnce(() => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- the point of the test: whatever is thrown, only a fixed code is printed
    throw thrown;
  });
  expect(resolveSecretFiles({ SESSION_SECRET_FILE: file }, ONLY).issues).toEqual([
    { variable: 'SESSION_SECRET_FILE', rule: `cannot read ${file} (UNKNOWN)` },
  ]);
});

test.each([
  ['exactly 64 KiB is read', 65_536, true],
  ['one byte over 64 KiB is refused', 65_537, false],
])('a file of %s', (_label, bytes, accepted) => {
  const files = secretDirectory();
  const file = files.write('big', 'x'.repeat(bytes));
  const resolved = resolveSecretFiles({ SESSION_SECRET_FILE: file }, ONLY);
  if (accepted) {
    expect(resolved).toMatchObject({ issues: [], env: { SESSION_SECRET: 'x'.repeat(bytes) } });
  } else {
    expect(resolved.issues).toEqual([{ variable: 'SESSION_SECRET_FILE', rule: 'file is larger than 64 KiB' }]);
    expect(resolved.env['SESSION_SECRET']).toBeUndefined();
  }
});

test('a file that grew past 64 KiB between the size check and the read is refused too', () => {
  const files = secretDirectory();
  const file = files.write('grows', 'small');
  vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => Buffer.alloc(65_537, 'x'));
  expect(resolveSecretFiles({ SESSION_SECRET_FILE: file }, ONLY).issues).toEqual([
    { variable: 'SESSION_SECRET_FILE', rule: 'file is larger than 64 KiB' },
  ]);
});

test('a path with a line break cannot forge a second line: control characters become ?, and a long path is cut', () => {
  const forged = resolveSecretFiles({ SESSION_SECRET_FILE: '/nonexistent/a\nSESSION_SECRET: forged\r\u0007' }, ONLY);
  expect(forged.issues[0]?.rule).toBe('cannot read /nonexistent/a?SESSION_SECRET: forged?? (ENOENT)');
  const path = ['', 'a'.repeat(100), 'b'.repeat(100), 'c'.repeat(100)].join('/');
  const long = resolveSecretFiles({ SESSION_SECRET_FILE: path }, ONLY);
  expect(long.issues[0]?.rule).toBe(`cannot read ${path.slice(0, 200)}... (ENOENT)`);
});

test('the content of a file never reaches an issue, whatever the failure', () => {
  const files = secretDirectory();
  const big = files.write('big', `LEAKCANARY${'x'.repeat(70_000)}`);
  const good = files.write('good', 'LEAKCANARY-value');
  const resolved = resolveSecretFiles(
    { SESSION_SECRET_FILE: big, GITHUB_CLIENT_SECRET: 'x', GITHUB_CLIENT_SECRET_FILE: good },
    ['SESSION_SECRET', 'GITHUB_CLIENT_SECRET'],
  );
  expect(resolved.issues).toHaveLength(2);
  expect(JSON.stringify(resolved.issues)).not.toContain('LEAKCANARY');
});

test('every variable in the list is read, the others are left alone, and the whole environment is kept', () => {
  const files = secretDirectory();
  const env = {
    SESSION_SECRET_FILE: files.write('session', 'one\n'),
    SETUP_TOKEN_FILE: files.write('setup', 'two\n'),
    HOST_FILE: files.write('host', 'not-a-secret\n'),
    PORT: '3000',
  };
  const resolved = resolveSecretFiles(env);
  expect(resolved.env).toEqual({ ...env, SESSION_SECRET: 'one', SETUP_TOKEN: 'two' });
  expect(resolved.env['HOST']).toBeUndefined();
});

test('every secret variable of the server is read by default: each one has a _FILE variant', () => {
  const files = secretDirectory();
  const names = [
    'GITHUB_APP_PRIVATE_KEY',
    'GITHUB_APP_PRIVATE_KEY_PREVIOUS',
    'GITHUB_WEBHOOK_SECRET',
    'GITHUB_WEBHOOK_SECRET_PREVIOUS',
    'GITHUB_CLIENT_SECRET',
    'SESSION_SECRET',
    'SETUP_TOKEN',
    'DATABASE_URL',
    'MIGRATION_DATABASE_URL',
  ];
  const env = Object.fromEntries(names.map((name) => [`${name}_FILE`, files.write(name, `${name}-value\n`)]));
  expect(resolveSecretFiles(env).env).toMatchObject(Object.fromEntries(names.map((name) => [name, `${name}-value`])));
});

test('two failures are two issues, one per variable, and both variables are marked failed', () => {
  const files = secretDirectory();
  const resolved = resolveSecretFiles(
    { SESSION_SECRET_FILE: files.at('a'), SETUP_TOKEN: 'x', SETUP_TOKEN_FILE: files.at('b') },
    ['SESSION_SECRET', 'SETUP_TOKEN'],
  );
  expect(resolved.issues.map((issue) => issue.variable)).toEqual([
    'SESSION_SECRET_FILE',
    'SETUP_TOKEN, SETUP_TOKEN_FILE',
  ]);
  expect(resolved.failed).toEqual(new Set(['SESSION_SECRET', 'SETUP_TOKEN']));
});
