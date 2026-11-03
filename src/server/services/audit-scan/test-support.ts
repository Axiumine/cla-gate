// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { AUDIT_ACTIONS, AUDIT_METADATA_KEYS } from '../../../shared/audit.ts';

// The source scan of E16-S01: which audit actions and metadata keys the server's code can write, and which file inserts
// into `audit_log`. Built on the TypeScript compiler API, so a call split over lines, a comment and a string that only
// looks like a call are told apart from a real one, and the type checker reads the names a call can write even when the
// action is a conditional or a field of a narrowed parameter.

const REPOSITORY = path.resolve(import.meta.dirname, '../../../..');

const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2025,
  lib: ['lib.es2025.d.ts'],
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  allowImportingTsExtensions: true,
  noEmit: true,
  skipLibCheck: true,
  strict: true,
  exactOptionalPropertyTypes: true,
  noUncheckedIndexedAccess: true,
  types: ['node'],
  typeRoots: [path.join(REPOSITORY, 'node_modules/@types')],
};

function parse(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function read(fileName: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: the name is a file of the source directory under scan, given by the test
  return fs.readFileSync(fileName, 'utf8');
}

/** One call of `appendAudit` in the code under scan, with the names it can write. */
export interface AuditCallSite {
  /** The file, relative to the scanned root, with forward slashes. */
  readonly file: string;
  readonly line: number;
  /** Every action the call can write, sorted. A conditional gives two. */
  readonly actions: readonly string[];
  /** Every metadata key the call can write, in any of its variants, sorted. */
  readonly metadataKeys: readonly string[];
  /** Why the call cannot be read statically; empty when it can. Such a call would hide names from the scan. */
  readonly problems: readonly string[];
}

/** A host that serves `overrides` (absolute path to text) as files and everything else from disk. */
function hostWith(overrides: ReadonlyMap<string, string>): ts.CompilerHost {
  const host = ts.createCompilerHost(OPTIONS);
  return {
    ...host,
    fileExists: (fileName) => overrides.has(fileName) || host.fileExists(fileName),
    readFile: (fileName) => overrides.get(fileName) ?? host.readFile(fileName),
    getSourceFile: (fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) => {
      const text = overrides.get(fileName);
      return text === undefined
        ? host.getSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile)
        : ts.createSourceFile(fileName, text, languageVersionOrOptions, true);
    },
  };
}

const sorted = (names: readonly string[]): string[] => [...new Set(names)].toSorted((a, b) => a.localeCompare(b));

const membersOf = (type: ts.Type): readonly ts.Type[] => (type.isUnion() ? type.types : [type]);

interface Reading {
  readonly names: string[];
  readonly problems: string[];
}

/** The actions the entry can carry: the string literal types of its `action` property. */
function actionsOf(checker: ts.TypeChecker, entryType: ts.Type, entry: ts.Node): Reading {
  const symbol = entryType.getProperty('action');
  if (symbol === undefined) {
    return { names: [], problems: ['the action of the entry cannot be read'] };
  }
  const members = membersOf(checker.getTypeOfSymbolAtLocation(symbol, entry));
  const names = sorted(members.flatMap((member) => (member.isStringLiteral() ? [member.value] : [])));
  return {
    names,
    problems: [
      ...(names.length === members.length ? [] : ['the action is not a string literal']),
      ...(names.length < AUDIT_ACTIONS.length
        ? []
        : ['the action is the whole AuditAction type: narrow it to the names the call writes']),
    ],
  };
}

/** The metadata keys the entry can carry: the property names of every variant of its `metadata` property. */
function metadataKeysOf(checker: ts.TypeChecker, entryType: ts.Type, entry: ts.Node): Reading {
  const symbol = entryType.getProperty('metadata');
  if (symbol === undefined) {
    return { names: [], problems: [] };
  }
  const type = checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(symbol, entry));
  const names = sorted(membersOf(type).flatMap((member) => checker.getPropertiesOfType(member).map((key) => key.name)));
  return {
    names,
    problems:
      names.length < AUDIT_METADATA_KEYS.length
        ? []
        : ['the metadata is the whole AuditMetadata type: write an object literal'],
  };
}

function isAppendAudit(checker: ts.TypeChecker, call: ts.CallExpression): boolean {
  const symbol = checker.getSymbolAtLocation(call.expression);
  const target =
    symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
  return target?.name === 'appendAudit';
}

function describeCall(
  checker: ts.TypeChecker,
  file: string,
  source: ts.SourceFile,
  call: ts.CallExpression,
): AuditCallSite {
  const line = source.getLineAndCharacterOfPosition(call.getStart(source)).line + 1;
  const entry = call.arguments[1];
  if (entry === undefined) {
    return { file, line, actions: [], metadataKeys: [], problems: ['the call has no entry'] };
  }
  const entryType = checker.getTypeAtLocation(entry);
  const actions = actionsOf(checker, entryType, entry);
  const metadata = metadataKeysOf(checker, entryType, entry);
  return {
    file,
    line,
    actions: actions.names,
    metadataKeys: metadata.names,
    problems: [...actions.problems, ...metadata.problems],
  };
}

function callsIn(node: ts.Node, found: ts.CallExpression[]): ts.CallExpression[] {
  if (ts.isCallExpression(node)) {
    found.push(node);
  }
  ts.forEachChild(node, (child) => {
    callsIn(child, found);
  });
  return found;
}

/** True when the code names `appendAudit` anywhere: an import, a call, a re-export or a property access. */
const namesWriter = (node: ts.Node): boolean =>
  (ts.isIdentifier(node) && node.text === 'appendAudit') || ts.forEachChild(node, namesWriter) === true;

/**
 * Every call of `appendAudit` in `files` (relative to `root`), in file order. Every file is parsed; the ones that name the
 * writer are put in one program so the checker can follow their imports. `overrides` maps a file name relative to `root`
 * to source text: it replaces or adds that file, which is how the unit tests scan made-up sources next to the real ones.
 */
export function auditCallSites(
  root: string,
  files: readonly string[],
  overrides: ReadonlyMap<string, string> = new Map(),
): AuditCallSite[] {
  const texts = new Map([...overrides].map(([file, text]) => [path.join(root, file), text]));
  const naming = new Map(
    files
      .map((file) => [path.join(root, file), file] as const)
      .filter(([absolute]) => namesWriter(parse(absolute, texts.get(absolute) ?? read(absolute)))),
  );
  const program = ts.createProgram([...naming.keys()], OPTIONS, hostWith(texts));
  const checker = program.getTypeChecker();
  return program.getSourceFiles().flatMap((source) => {
    const file = naming.get(source.fileName);
    return file === undefined
      ? []
      : callsIn(source, [])
          .filter((call) => isAppendAudit(checker, call))
          .map((call) => describeCall(checker, file, source, call));
  });
}

/** The text of a string or template literal as a statement of SQL would read it, with the parts to fill in left out. */
function literalText(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return ts.isTemplateExpression(node)
    ? [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(' ')
    : undefined;
}

/** The table an `insert into` statement names, read after {@link plainSql}; the schema may come first. */
/** The audit table, alone or after a schema. */
const AUDIT_TABLE = /(?:^|\.)audit_log$/i;

const INSERT_TARGET = /\binsert into ([\w.]+)/gi;

/** The text of a statement with the quotes taken out and every run of blanks, and the blanks around a dot, made one blank or none. */
const plainSql = (text: string): string =>
  text
    .replaceAll('"', '')
    .replaceAll(/\s+/g, ' ')
    .replaceAll(/ ?\. ?/g, '.');

/** What node `node` is, if it inserts into `audit_log`: a Kysely `insertInto('audit_log')` or a literal with `insert into audit_log`. */
function insertionOf(node: ts.Node): string[] {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'insertInto'
  ) {
    const table = node.arguments[0] === undefined ? undefined : literalText(node.arguments[0]);
    return table?.trim().replace(/^public\./, '') === 'audit_log' ? ["insertInto('audit_log')"] : [];
  }
  const text = literalText(node);
  const targets =
    text === undefined ? [] : [...plainSql(text).matchAll(INSERT_TARGET)].flatMap((match) => match.slice(1));
  return targets.some((target) => AUDIT_TABLE.test(target)) ? ['insert into audit_log'] : [];
}

function insertionsIn(node: ts.Node, found: string[]): string[] {
  found.push(...insertionOf(node));
  ts.forEachChild(node, (child) => {
    insertionsIn(child, found);
  });
  return found;
}

/**
 * The ways `source` inserts into `audit_log`: a Kysely `insertInto('audit_log')` call and a string or template that holds
 * an `insert into audit_log` statement. Comments are not statements and are not reported. Only the audit writer may have any.
 */
export function auditInsertions(fileName: string, source: string): string[] {
  return insertionsIn(parse(fileName, source), []);
}

/** What is wrong with the catalogue `actions`: a name `required` that is missing, with the name, and a name listed twice. */
export function catalogueProblems(actions: readonly string[], required: readonly string[]): string[] {
  return [
    ...required
      .filter((name) => !actions.includes(name))
      .map((name) => `AUDIT_ACTIONS lacks ${name}: add it in the change that writes it`),
    ...sorted(actions.filter((name, index) => actions.indexOf(name) !== index)).map(
      (name) => `AUDIT_ACTIONS lists ${name} more than once`,
    ),
  ];
}

/**
 * What is wrong with the way the catalogue `actions` is written to: a name a call site writes that the catalogue lacks, a
 * name nobody writes that is not `reserved` (with a reason), a reserved name that is written after all or is not in the
 * catalogue, and a reason that is empty or longer than one line.
 */
export function usageProblems(
  actions: readonly string[],
  written: ReadonlySet<string>,
  reserved: Readonly<Record<string, string>>,
): string[] {
  return [
    ...[...written]
      .filter((name) => !actions.includes(name))
      .map((name) => `${name} is written by a call site but is not in AUDIT_ACTIONS`),
    ...actions
      .filter((name) => !written.has(name) && !Object.hasOwn(reserved, name))
      .map((name) => `${name} is written by no call site and is not in RESERVED_ACTIONS`),
    ...Object.keys(reserved)
      .filter((name) => written.has(name))
      .map((name) => `${name} is in RESERVED_ACTIONS but a call site writes it: remove the entry`),
    ...Object.keys(reserved)
      .filter((name) => !actions.includes(name))
      .map((name) => `${name} is in RESERVED_ACTIONS but not in AUDIT_ACTIONS`),
    ...Object.entries(reserved)
      .filter(([, reason]) => !/^[^\r\n]+$/.test(reason))
      .map(([name]) => `${name} is in RESERVED_ACTIONS without a one-line reason`),
  ];
}
