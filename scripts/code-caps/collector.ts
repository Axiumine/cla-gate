// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import ts from 'typescript';
import { type Callable, type ClassLike, containerName, displayName, isCallable, isClassLike } from './naming.ts';
import { nestingDepth } from './nesting.ts';
import { CAPS, type Kind, type Measure } from './types.ts';

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

/** Walks one module and collects the violations, tracking the qualified name of every def. */
export class Collector {
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
    // eslint-disable-next-line security/detect-object-injection -- kind is the closed Kind union, never user input
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
