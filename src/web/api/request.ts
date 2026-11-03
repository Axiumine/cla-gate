// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { z } from 'zod';
import { CSRF_HEADER } from '../../shared/auth-contract.ts';
import { fillPath, type Route, type RouteMethod, type RouteQuery } from '../../shared/contract.ts';
import { ContractError, type ContractPart, issuePaths } from './errors.ts';

// How a call becomes a request (E17-S04): the input is checked against the schemas of the route, the path parameters are
// encoded, and the headers are exactly the ones below. The client has no way to set another, so no `Authorization` and no
// `Cookie` header can ever be added to a request (the browser sends the session cookie itself, `credentials: same-origin`).

/** What the input of a call looks like once the generics are erased. */
export interface LooseInput {
  readonly params?: unknown;
  readonly query?: unknown;
  readonly body?: unknown;
}

/** A request ready for `fetch`: the URL (path and query) and the JSON text of the body, or none. */
export interface PreparedRequest {
  readonly url: string;
  readonly body: string | undefined;
}

/** Everything except GET and HEAD changes state and carries the CSRF token (E10-S03). */
export function changesState(method: RouteMethod): boolean {
  return method !== 'GET' && method !== 'HEAD';
}

function parsePart<Schema extends z.ZodType>(
  route: Route,
  part: ContractPart,
  schema: Schema,
  value: unknown,
): z.output<Schema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ContractError(route.name, part, issuePaths(result.error));
  }
  return result.data;
}

/** A value that is safe as one path segment: text or a finite number, and not empty or a dot segment a URL parser resolves. */
function isSegment(value: unknown): value is string | number {
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  return typeof value === 'string' && value !== '' && value !== '.' && value !== '..';
}

function buildPath(route: Route, params: unknown): string {
  if (route.params === undefined) {
    return route.path;
  }
  const parsed = parsePart(route, 'params', route.params, params);
  const values = new Map<string, unknown>(Object.entries(parsed));
  return fillPath(route.path, (name) => {
    const value = values.get(name);
    if (!isSegment(value)) {
      throw new ContractError(route.name, 'params', [name]);
    }
    return encodeURIComponent(String(value));
  });
}

/** `?a=1&a=2&b=x`: a list is repeated keys, `undefined` is left out. */
function queryString(query: RouteQuery): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const item of [value].flat()) {
      if (item !== undefined) {
        search.append(key, String(item));
      }
    }
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

function buildQuery(route: Route, query: unknown): string {
  if (route.query === undefined) {
    return '';
  }
  return queryString(parsePart(route, 'query', route.query, query));
}

/** Checks the input against the route and builds the URL and the JSON body. A body that parses to `undefined` is no body. */
export function prepareRequest(route: Route, input: LooseInput): PreparedRequest {
  const url = buildPath(route, input.params) + buildQuery(route, input.query);
  const body = route.body === undefined ? undefined : parsePart(route, 'body', route.body, input.body);
  return { url, body: body === undefined ? undefined : JSON.stringify(body) };
}

/** The request headers: JSON in and out, and the CSRF token on a call that changes state when there is one. */
export function requestHeaders(
  route: Route,
  prepared: PreparedRequest,
  csrfToken: string | undefined,
): Record<string, string> {
  return {
    accept: 'application/json',
    ...(prepared.body === undefined ? {} : { 'content-type': 'application/json' }),
    ...(csrfToken === undefined || !changesState(route.method) ? {} : { [CSRF_HEADER]: csrfToken }),
  };
}
