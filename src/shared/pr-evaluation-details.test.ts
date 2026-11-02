// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { PrEvaluationDetails, parseStoredDetails } from './pr-evaluation-details.ts';
import { storedDetailsSample } from './test-support.ts';

// A JSON value, so that a sample can be copied and broken one field at a time without a single `any`.
type Json = null | boolean | number | string | Json[] | JsonObject;
interface JsonObject {
  [key: string]: Json;
}
type Path = readonly (string | number)[];
const REMOVE = Symbol('remove');
type Change = Json | typeof REMOVE;

const isJsonObject = (node: Json): node is JsonObject =>
  typeof node === 'object' && node !== null && !Array.isArray(node);

function inObject(node: JsonObject, key: string, rest: Path, change: Change): JsonObject {
  const copy = new Map(Object.entries(node));
  if (rest.length === 0 && change === REMOVE) {
    copy.delete(key);
  } else {
    copy.set(key, broken(rest, change, copy.get(key) ?? null));
  }
  return Object.fromEntries(copy);
}

/**
 * The sample as plain JSON with the value at `path` replaced, or its key removed when `change` is REMOVE.
 * @returns The changed copy of `node`, whatever shape that part of the sample has.
 */
function broken(path: Path, change: Change, node: Json = storedDetailsSample()): Json {
  const [head, ...rest] = path;
  if (head === undefined) {
    if (change === REMOVE) throw new Error('There is no key to remove at the root.');
    return change;
  }
  if (Array.isArray(node) && typeof head === 'number') {
    return node.map((child, index) => (index === head ? broken(rest, change, child) : child));
  }
  if (isJsonObject(node) && typeof head === 'string') return inObject(node, head, rest, change);
  throw new Error(`The sample has nothing at ${path.join('.')}`);
}

const accepted = (value: unknown): boolean => parseStoredDetails(value).ok;

test('a valid sample round-trips through the schema and through JSON unchanged', () => {
  const sample = storedDetailsSample();
  expect(PrEvaluationDetails.parse(sample)).toEqual(sample);
  const viaJson: unknown = JSON.parse(JSON.stringify(sample));
  expect(parseStoredDetails(viaJson)).toEqual({ ok: true, details: sample });
});

test('a passing evaluation with nothing to report is valid', () => {
  const passing = { ...storedDetailsSample(), outcome: 'success', failureCodes: [], unlinked: [], advisories: [] };
  expect(accepted({ ...passing, actors: [] })).toBe(true);
});

test('a repository without an active CLA stores no document and no major', () => {
  const noPolicy = { ...storedDetailsSample(), failureCodes: ['no_active_cla'], documentId: null, activeMajor: null };
  expect(accepted({ ...noPolicy, actors: [{ githubId: 1, roles: ['opener'], covered: false, basis: null }] })).toBe(
    true,
  );
});

test.each([
  ['commit_limit_exceeded', 'exceeded'],
  ['unsigned_contributor', 'complete'],
])('the failure code %s is stored with listing %s', (code, listing) => {
  expect(accepted({ ...storedDetailsSample(), failureCodes: [code], listing })).toBe(true);
});

const WRONGLY_TYPED: readonly (readonly [string, Path, Json])[] = [
  ['version as a string', ['version'], '1'],
  ['version as a float', ['version'], 1.5],
  ['outcome as a number', ['outcome'], 1],
  ['outcome that is no outcome', ['outcome'], 'passed'],
  ['failureCodes as a string', ['failureCodes'], 'unsigned_contributor'],
  ['failureCodes with a number', ['failureCodes'], [1]],
  ['failureCodes with an unknown code', ['failureCodes'], ['octocat']],
  ['documentId as a string', ['documentId'], '12'],
  ['documentId of zero', ['documentId'], 0],
  ['documentId negative', ['documentId'], -1],
  ['documentId fractional', ['documentId'], 1.5],
  ['documentId above the safe range', ['documentId'], 2 ** 53],
  ['activeMajor as a string', ['activeMajor'], '2'],
  ['activeMajor of zero', ['activeMajor'], 0],
  ['commitCount negative', ['commitCount'], -1],
  ['commitCount fractional', ['commitCount'], 1.5],
  ['commitCount as a string', ['commitCount'], '3'],
  ['commitCount null', ['commitCount'], null],
  ['mergeCommitsSkipped negative', ['mergeCommitsSkipped'], -1],
  ['mergeCommitsSkipped as a string', ['mergeCommitsSkipped'], '1'],
  ['listing that is no state', ['listing'], 'partial'],
  ['listing as a number', ['listing'], 1],
  ['actors as an object', ['actors'], {}],
  ['actors as a string', ['actors'], 'octocat'],
  ['an actor that is null', ['actors', 0], null],
  ['actor githubId as a string', ['actors', 0, 'githubId'], '1001'],
  ['actor githubId of zero', ['actors', 0, 'githubId'], 0],
  ['actor githubId negative', ['actors', 0, 'githubId'], -5],
  ['actor githubId fractional', ['actors', 0, 'githubId'], 1.5],
  ['actor githubId above the safe range', ['actors', 0, 'githubId'], 2 ** 53],
  ['actor roles as a string', ['actors', 0, 'roles'], 'opener'],
  ['actor roles empty', ['actors', 0, 'roles'], []],
  ['actor roles with an unknown role', ['actors', 0, 'roles'], ['maintainer']],
  ['actor roles with a number', ['actors', 0, 'roles'], [1]],
  ['actor covered as a string', ['actors', 0, 'covered'], 'true'],
  ['actor covered as a number', ['actors', 0, 'covered'], 1],
  ['actor basis as a string', ['actors', 0, 'basis'], 'signature'],
  ['actor basis as an empty object', ['actors', 0, 'basis'], {}],
  ['actor basis as an array', ['actors', 0, 'basis'], []],
  ['basis kind unknown', ['actors', 0, 'basis', 'kind'], 'corporate_approval'],
  ['basis kind as a number', ['actors', 0, 'basis', 'kind'], 1],
  ['signatureId as a string', ['actors', 0, 'basis', 'signatureId'], '31'],
  ['signatureId of zero', ['actors', 0, 'basis', 'signatureId'], 0],
  ['versionId negative', ['actors', 0, 'basis', 'versionId'], -7],
  ['basis major of zero', ['actors', 0, 'basis', 'major'], 0],
  ['basis major as a string', ['actors', 0, 'basis', 'major'], '2'],
  ['entryId as a string', ['actors', 1, 'basis', 'entryId'], '4'],
  ['entryKind that is a login', ['actors', 1, 'basis', 'entryKind'], 'octocat'],
  ['entryKind as a number', ['actors', 1, 'basis', 'entryKind'], 2],
  ['scope that is no scope', ['actors', 1, 'basis', 'scope'], 'org'],
  ['unlinked as an object', ['unlinked'], {}],
  ['an unlinked finding that is a string', ['unlinked', 0], 'deadbeef'],
  ['unlinked sha as a number', ['unlinked', 0, 'sha'], 123],
  ['unlinked sha that is a login', ['unlinked', 0, 'sha'], 'octocat'],
  ['unlinked sha in upper case', ['unlinked', 0, 'sha'], 'A'.repeat(40)],
  ['unlinked sha of 39 characters', ['unlinked', 0, 'sha'], 'a'.repeat(39)],
  ['unlinked sha of 41 characters', ['unlinked', 0, 'sha'], 'a'.repeat(41)],
  ['unlinked sha of 63 characters', ['unlinked', 1, 'sha'], 'b'.repeat(63)],
  ['unlinked sha of 65 characters', ['unlinked', 1, 'sha'], 'b'.repeat(65)],
  ['unlinked sha with a non-hex digit', ['unlinked', 0, 'sha'], `${'a'.repeat(39)}g`],
  ['unlinked role opener', ['unlinked', 0, 'role'], 'opener'],
  ['unlinked role co_author', ['unlinked', 0, 'role'], 'co_author'],
  ['unlinked role as a number', ['unlinked', 0, 'role'], 1],
  ['overrideId as a string', ['unlinked', 1, 'overrideId'], '55'],
  ['overrideId of zero', ['unlinked', 1, 'overrideId'], 0],
  ['advisories as an object', ['advisories'], {}],
  ['advisory code unknown', ['advisories', 0, 'code'], 'new_code'],
  ['advisory code as a number', ['advisories', 0, 'code'], 1],
  ['advisory sha as a number', ['advisories', 0, 'sha'], 7],
  ['advisory sha that is an email', ['advisories', 0, 'sha'], 'a@example.org'],
];

test.each(WRONGLY_TYPED)('%s is refused', (_label, path, value) => {
  expect(parseStoredDetails(broken(path, value))).toEqual({ ok: false });
});

const KEYS: readonly Path[] = [
  ['version'],
  ['outcome'],
  ['failureCodes'],
  ['documentId'],
  ['activeMajor'],
  ['commitCount'],
  ['mergeCommitsSkipped'],
  ['listing'],
  ['actors'],
  ['unlinked'],
  ['advisories'],
  ['actors', 0, 'githubId'],
  ['actors', 0, 'roles'],
  ['actors', 0, 'covered'],
  ['actors', 0, 'basis'],
  ['actors', 0, 'basis', 'kind'],
  ['actors', 0, 'basis', 'signatureId'],
  ['actors', 0, 'basis', 'versionId'],
  ['actors', 0, 'basis', 'major'],
  ['actors', 1, 'basis', 'entryId'],
  ['actors', 1, 'basis', 'entryKind'],
  ['actors', 1, 'basis', 'scope'],
  ['unlinked', 0, 'sha'],
  ['unlinked', 0, 'role'],
  ['unlinked', 0, 'overrideId'],
  ['advisories', 0, 'code'],
  ['advisories', 0, 'sha'],
];

test.each(KEYS)('a value without %j is refused', (...path) => {
  expect(parseStoredDetails(broken(path, REMOVE))).toEqual({ ok: false });
});

// Where a login, a name or an email could be written: next to a field, as a field, or inside one. All strict.
const SMUGGLED: readonly (readonly [string, Path])[] = [
  ['the root', []],
  ['an actor', ['actors', 0]],
  ['a signature basis', ['actors', 0, 'basis']],
  ['an allowlist basis', ['actors', 1, 'basis']],
  ['an unlinked finding', ['unlinked', 0]],
  ['an advisory', ['advisories', 0]],
];

test.each(SMUGGLED)('an extra key on %s is refused', (_where, path) => {
  expect(parseStoredDetails(broken([...path, 'login'], 'octocat'))).toEqual({ ok: false });
});

test.each([
  ['login', 'octocat'],
  ['email', 'octocat@example.org'],
  ['name', 'Mona Lisa Octocat'],
  ['entryKind', 'octocat'],
])('%s smuggled into a covering basis is refused', (key, value) => {
  const withLogin = broken(['actors', 1, 'basis', key], value);
  expect(parseStoredDetails(withLogin)).toEqual({ ok: false });
  expect(accepted(broken(['actors', 0, 'basis', key], value))).toBe(false);
});

test.each([
  ['0', 0],
  ['2', 2],
  ['the string 1', '1'],
  ['null', null],
])('version %s is refused, only version 1 is read', (_label, version) => {
  expect(parseStoredDetails(broken(['version'], version))).toEqual({ ok: false });
});

test.each([
  ['a covered actor without a basis', ['actors', 0, 'basis'], null],
  ['an uncovered actor with a basis', ['actors', 2, 'covered'], true],
  ['a document without a major', ['activeMajor'], null],
  ['a major without a document', ['documentId'], null],
  ['a success that lists a failure', ['outcome'], 'success'],
  ['a failure that lists none', ['failureCodes'], []],
] as const satisfies readonly (readonly [string, Path, Json])[])(
  '%s contradicts itself and is refused',
  (_label, path, value) => {
    expect(parseStoredDetails(broken(path, value))).toEqual({ ok: false });
  },
);

test.each([
  ['null', null],
  ['undefined', undefined],
  ['a string', '{"version":1}'],
  ['a number', 1],
  ['an array', [storedDetailsSample()]],
  ['an empty object, as an in-progress row stores it', {}],
  ['an object of the old shape', { version: 0, result: 'success', actors: [] }],
])('%s is not a stored evaluation', (_label, value) => {
  expect(parseStoredDetails(value)).toEqual({ ok: false });
});

test('reading never throws, not even for a value whose getter or proxy does', () => {
  const trap = new Error('boom');
  const getter = Object.defineProperty({}, 'version', {
    enumerable: true,
    get: () => {
      throw trap;
    },
  });
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  expect(parseStoredDetails(getter)).toEqual({ ok: false });
  expect(parseStoredDetails(proxy)).toEqual({ ok: false });
});
