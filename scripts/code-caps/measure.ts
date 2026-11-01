// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import ts from 'typescript';
import { type Callable, type ClassLike, containerName, displayName, isCallable, isClassLike } from './naming.ts';
import { CAPS, CapsError, type Kind, type Measure, measureKey } from './types.ts';

/** Statement list owned by a block statement, and how much deeper it sits (0 for `else if`). */
interface Branch {
  readonly stmts: readonly ts.Statement[];
  readonly offset: 0 | 1;
}

const PARSE_OPTIONS: ts.CompilerOptions = { noLib: true, noResolve: true, allowJs: true, types: [] };

// --------------------------------------------------------------------------- parsing

/** Parse one module. Throws `CapsError` (file and line) on a syntax error. */
function parse(source: string, rel: string): ts.SourceFile {
  const file = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true);
  const host = ts.createCompilerHost(PARSE_OPTIONS);
  host.getSourceFile = () => file;
  const program = ts.createProgram({ rootNames: [rel], options: PARSE_OPTIONS, host });
  const [first] = program.getSyntacticDiagnostics(file);
  if (first !== undefined) {
    const line = file.getLineAndCharacterOfPosition(first.start).line + 1;
    throw new CapsError(`${rel}:${line}: ${ts.flattenDiagnosticMessageText(first.messageText, '\n')}`);
  }
  return file;
}

// --------------------------------------------------------------------------- measures

/** Number of lines of a text: a trailing line break does not start a new line. */
export function countLines(text: string): number {
  const parts = text.split(/\r\n|[\n\r\u2028\u2029]/);
  return parts.length - (parts.at(-1) === '' ? 1 : 0);
}

function lineOf(file: ts.SourceFile, position: number): number {
  return file.getLineAndCharacterOfPosition(position).line + 1;
}

/** First line (decorators and modifiers included) and number of lines of a node. */
function span(file: ts.SourceFile, node: ts.Node): { start: number; length: number } {
  const start = lineOf(file, node.getStart(file));
  return { start, length: lineOf(file, node.getEnd()) - start + 1 };
}

/** Parameters of `node`; the fake `this` parameter of a function is free. */
function countParams(node: Callable): number {
  if (ts.isClassStaticBlockDeclaration(node)) {
    return 0;
  }
  const isThis = (param: ts.ParameterDeclaration): boolean => ts.isIdentifier(param.name) && param.name.text === 'this';
  return node.parameters.filter((param) => !isThis(param)).length;
}

// --------------------------------------------------------------------------- nesting

function asList(stmt: ts.Statement): readonly ts.Statement[] {
  return ts.isBlock(stmt) ? stmt.statements : [stmt];
}

/** An `else if` is an `if` that is the whole else branch: it stays on the parent's level. */
function ifBranches(stmt: ts.IfStatement): Branch[] {
  const branches: Branch[] = [{ stmts: asList(stmt.thenStatement), offset: 1 }];
  if (stmt.elseStatement !== undefined) {
    const offset = ts.isIfStatement(stmt.elseStatement) ? 0 : 1;
    branches.push({ stmts: asList(stmt.elseStatement), offset });
  }
  return branches;
}

function tryBranches(stmt: ts.TryStatement): Branch[] {
  const blocks = [stmt.tryBlock, stmt.catchClause?.block, stmt.finallyBlock];
  return blocks.filter((block) => block !== undefined).map((block): Branch => ({ stmts: block.statements, offset: 1 }));
}

function switchBranches(stmt: ts.SwitchStatement): Branch[] {
  return stmt.caseBlock.clauses.map((clause): Branch => ({ stmts: clause.statements, offset: 1 }));
}

/** Loops and `with` own one level; bare blocks and labels are transparent. */
function bodyBranches(stmt: ts.Statement): Branch[] {
  if (ts.isBlock(stmt)) {
    return [{ stmts: stmt.statements, offset: 0 }];
  }
  if (ts.isLabeledStatement(stmt)) {
    return [{ stmts: asList(stmt.statement), offset: 0 }];
  }
  if (ts.isIterationStatement(stmt, false) || ts.isWithStatement(stmt)) {
    return [{ stmts: asList(stmt.statement), offset: 1 }];
  }
  return [];
}

function childBranches(stmt: ts.Statement): Branch[] {
  if (ts.isIfStatement(stmt)) {
    return ifBranches(stmt);
  }
  if (ts.isTryStatement(stmt)) {
    return tryBranches(stmt);
  }
  if (ts.isSwitchStatement(stmt)) {
    return switchBranches(stmt);
  }
  return bodyBranches(stmt);
}

/**
 * Deepest block nesting below `stmts`. Only statements are walked, so nested functions and classes
 * (always reached through an expression or a declaration) are measured on their own.
 */
export function nestingDepth(stmts: readonly ts.Statement[], depth = 0): number {
  let best = depth;
  for (const stmt of stmts) {
    for (const branch of childBranches(stmt)) {
      best = Math.max(best, nestingDepth(branch.stmts, depth + branch.offset));
    }
  }
  return best;
}

// --------------------------------------------------------------------------- collector

/** Walks one module and collects the violations, tracking the qualified name of every def. */
class Collector {
  readonly found: Measure[] = [];
  readonly #file: ts.SourceFile;
  readonly #path: string;

  constructor(file: ts.SourceFile, path: string) {
    this.#file = file;
    this.#path = path;
  }

  visit(node: ts.Node, scope: readonly string[]): void {
    if (isCallable(node)) {
      this.#callable(node, scope);
    } else if (isClassLike(node)) {
      this.#class(node, scope);
    } else {
      const name = containerName(node, this.#file);
      this.#descend(node, name === undefined ? scope : [...scope, name]);
    }
  }

  #record(line: number, kind: Kind, name: string, value: number): void {
    if (value > CAPS[kind]) {
      this.found.push({ path: this.#path, line, kind, name, value });
    }
  }

  #callable(node: Callable, scope: readonly string[]): void {
    const name = displayName(node, this.#file);
    const qualified = [...scope, name].join('.');
    const { start, length } = span(this.#file, node);
    const body = ts.isBlock(node.body) ? node.body.statements : [];
    this.#record(start, 'function', qualified, length);
    this.#record(start, 'params', qualified, countParams(node));
    this.#record(start, 'nesting', qualified, nestingDepth(body));
    this.#descend(node, [...scope, name]);
  }

  #class(node: ClassLike, scope: readonly string[]): void {
    const name = displayName(node, this.#file);
    const { start, length } = span(this.#file, node);
    this.#record(start, 'class', [...scope, name].join('.'), length);
    this.#descend(node, [...scope, name]);
  }

  #descend(node: ts.Node, scope: readonly string[]): void {
    ts.forEachChild(node, (child) => {
      this.visit(child, scope);
    });
  }
}

/** Make keys unique when a qualified name repeats (anonymous callbacks, overloads): `name#2`. */
export function dedupeNames(found: readonly Measure[]): Measure[] {
  const seen = new Map<string, number>();
  return found.map((item) => {
    const count = (seen.get(measureKey(item)) ?? 0) + 1;
    seen.set(measureKey(item), count);
    return count === 1 ? item : { ...item, name: `${item.name}#${count}` };
  });
}

function measureParsed(source: string, rel: string): Measure[] {
  const file = parse(source, rel);
  const found: Measure[] = [];
  const lines = countLines(source);
  if (lines > CAPS.file) {
    found.push({ path: rel, line: 1, kind: 'file', name: '-', value: lines });
  }
  const collector = new Collector(file, rel);
  collector.visit(file, []);
  return dedupeNames([...found, ...collector.found]);
}

/** All violations in one module's source text. Throws `CapsError` on a syntax error or an unmeasurable file. */
export function measureSource(source: string, rel: string): Measure[] {
  try {
    return measureParsed(source, rel);
  } catch (cause) {
    if (cause instanceof CapsError) {
      throw cause;
    }
    throw new CapsError(`${rel}: cannot measure: ${String(cause)}`, { cause });
  }
}
