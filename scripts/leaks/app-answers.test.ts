// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { createDocumentRoute, documentListRoute } from '../../src/shared/cla-routes.ts';
import { responseSchemaFor } from '../../src/shared/contract.ts';
import { APP_ANSWERS, type AppAnswer, answerOf, answerTable } from './app-answers.ts';

// E18-S12: the made-up API of the leak scenarios of the screens stays inside the contract of the real one.

/** Whether `path` is a path of the route: the same segments, each `:placeholder` standing for one segment that is not empty. */
function isPathOf(answer: AppAnswer): boolean {
  const actual = answer.path.split('/');
  const template = answer.route.path.split('/');
  return (
    template.length === actual.length &&
    template.every((segment, index) =>
      segment.startsWith(':') ? actual.at(index) !== '' : segment === actual.at(index),
    )
  );
}

test.each(APP_ANSWERS.map((answer) => [answer.route.name, answer] as const))(
  '%s: the body is what the route declares for its 200',
  (_name, answer) => {
    expect(responseSchemaFor(answer.route, 200)?.safeParse(answer.body).success).toBe(true);
  },
);

test.each(APP_ANSWERS.map((answer) => [answer.path, answer] as const))(
  '%s is a path of its route, which the page reads with GET',
  (_path, answer) => {
    expect(isPathOf(answer)).toBe(true);
    expect(answer.route.method).toBe('GET');
  },
);

test('no two answers share a path, so the table says what the list says', () => {
  const paths = APP_ANSWERS.map((answer) => answer.path);
  expect(new Set(paths).size).toBe(paths.length);
  expect(answerTable().size).toBe(paths.length);
});

test('the table answers every path with the body of its answer', () => {
  const table = answerTable();
  for (const answer of APP_ANSWERS) {
    expect(table.get(answer.path)).toBe(answer.body);
  }
});

test('the two tenants the scenarios switch between are both listed, each with its documents', () => {
  const paths = APP_ANSWERS.map((answer) => answer.path);
  expect(paths).toEqual(
    expect.arrayContaining([
      '/api/auth/session',
      '/api/installations',
      '/api/installations/9001/documents',
      '/api/installations/9002/documents',
      '/api/installations/9001/documents/9201',
    ]),
  );
});

test('the path of an answer is the path of its route with the parameters put in', () => {
  const answer = answerOf(documentListRoute, { installationId: 42 }, { documents: [], nextCursor: null });
  expect(answer.path).toBe('/api/installations/42/documents');
  expect(answer.route).toBe(documentListRoute);
});

test('a body that does not fit its route is refused, and the error names the route', () => {
  expect(() => answerOf(documentListRoute, { installationId: 42 }, { documents: 'none' })).toThrow(
    'the made-up answer of GET /api/installations/:installationId/documents does not fit its schema',
  );
});

test('a route that declares no 200 has no made-up answer, because the page could not read one', () => {
  expect(() => answerOf(createDocumentRoute, { installationId: 42 }, {})).toThrow(
    'the made-up answer of POST /api/installations/:installationId/documents does not fit its schema',
  );
});
