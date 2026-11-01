// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import ts from 'typescript';

/** Every function-like node that has a body (overload signatures and abstract methods have none). */
export type Callable = (
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.AccessorDeclaration
  | ts.ClassStaticBlockDeclaration
) & { readonly body: ts.Node };

export type ClassLike = ts.ClassDeclaration | ts.ClassExpression;

const ACCESSOR_LABEL = new Map<ts.SyntaxKind, string>([
  [ts.SyntaxKind.GetAccessor, 'get '],
  [ts.SyntaxKind.SetAccessor, 'set '],
]);

/** Longest callee or string argument kept in the name of a callback. */
const LABEL_LIMIT = 40;

export function isCallable(node: ts.Node): node is Callable {
  return (
    (ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isAccessor(node) ||
      ts.isClassStaticBlockDeclaration(node)) &&
    node.body !== undefined
  );
}

export function isClassLike(node: ts.Node): node is ClassLike {
  return ts.isClassDeclaration(node) || ts.isClassExpression(node);
}

function isWrapper(node: ts.Node): boolean {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isTypeAssertionExpression(node)
  );
}

/** The node itself, or the outermost parentheses, `as`, `satisfies`, `!` or `<T>` around it. */
function outermost(node: ts.Node): ts.Node {
  let current = node;
  while (isWrapper(current.parent)) {
    current = current.parent;
  }
  return current;
}

/** Name of the variable, property or assignment target that receives a value. */
function bindingName(parent: ts.Node, file: ts.SourceFile): string | undefined {
  if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) {
    return parent.name.getText(file);
  }
  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    return parent.left.getText(file);
  }
  return undefined;
}

/**
 * Stable name of a callback passed to a call: `describe("name")`, `items.map()`. It does not depend
 * on how many other callbacks exist, so fixing one never renumbers the baseline keys of the others.
 */
function callbackName(outer: ts.Node, file: ts.SourceFile): string | undefined {
  const call = outer.parent;
  if (!ts.isCallExpression(call) || !call.arguments.some((argument) => argument === outer)) {
    return undefined;
  }
  const [first] = call.arguments;
  const label =
    first !== undefined && ts.isStringLiteralLike(first) ? JSON.stringify(first.text.slice(0, LABEL_LIMIT)) : '';
  const callee = call.expression.getText(file).replace(/\s+/g, ' ').slice(0, LABEL_LIMIT);
  return `${callee}(${label})`;
}

/** Name for an unnamed function or class from where it sits. */
function inferName(node: ts.Node, file: ts.SourceFile): string {
  const outer = outermost(node);
  const named = bindingName(outer.parent, file) ?? callbackName(outer, file);
  if (named !== undefined) {
    return named;
  }
  const isDefault =
    ts.isExportAssignment(outer.parent) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node);
  return isDefault ? 'default' : '<anonymous>';
}

export function displayName(node: Callable | ClassLike, file: ts.SourceFile): string {
  if (ts.isConstructorDeclaration(node)) {
    return 'constructor';
  }
  if (ts.isClassStaticBlockDeclaration(node)) {
    return 'static';
  }
  const own = ts.isArrowFunction(node) ? undefined : node.name;
  const base = own === undefined ? inferName(node, file) : own.getText(file);
  return `${ACCESSOR_LABEL.get(node.kind) ?? ''}${base}`;
}

/** Name a namespace or a named object literal adds to the qualified name of what it holds. */
export function containerName(node: ts.Node, file: ts.SourceFile): string | undefined {
  if (ts.isModuleDeclaration(node)) {
    return node.name.getText(file);
  }
  return ts.isObjectLiteralExpression(node) ? bindingName(outermost(node).parent, file) : undefined;
}
