// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import ts from 'typescript';

/** Statement list owned by a block statement, and how much deeper it sits (0 for `else if`). */
interface Branch {
  readonly stmts: readonly ts.Statement[];
  readonly offset: 0 | 1;
}

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
  // Stryker disable next-line BooleanLiteral: a labelled statement is answered by the branch above, so no label is ever left for this call to look through
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
