// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { z } from 'zod';

// Route descriptors (E17-S04): one value per API route that says its method, path and the zod schema of every part of the
// request and of each response. The web client builds and checks its calls from them, and the server registers a route from
// the same descriptor, so a path or a body that changes in one place changes in both. This module imports neither
// src/server nor src/web.

/** The HTTP methods a route may use. */
export type RouteMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** One value of a query string. A list is sent as repeated keys. */
type QueryScalar = string | number | boolean;

/** What a query schema may produce: scalars and lists of scalars, with `undefined` meaning "leave it out". */
export type RouteQuery = Readonly<Record<string, QueryScalar | readonly QueryScalar[] | undefined>>;

/**
 * What a route says about itself. `path` is the Fastify spelling: `/api/things/:thingId`. The keys of `params` are exactly
 * the placeholders of `path`. `responses` maps a status code to the schema of its body: a success (2xx) entry is what the
 * client returns, and an entry for another status documents what the server registers for it. The client reads every
 * non-2xx answer with the standard error body (`errorResponseSchema`, E04). A body-less answer such as 204 is
 * `z.undefined()`.
 */
export interface RouteSpec {
  readonly method: RouteMethod;
  readonly path: string;
  readonly params?: z.ZodObject;
  readonly query?: z.ZodType<RouteQuery>;
  readonly body?: z.ZodType;
  readonly responses: Readonly<Record<number, z.ZodType>>;
}

/** A defined route: the spec as written, frozen, plus its `name` (`GET /api/things/:thingId`), which is safe to log. */
export type Route<Spec extends RouteSpec = RouteSpec> = Readonly<Spec> & {
  readonly name: `${Spec['method']} ${Spec['path']}`;
};

// A path is made of plain segments and :placeholders only: no dot segment a URL parser would resolve, no query, no fragment.
const SEGMENT = /^(?:[A-Za-z0-9_~-][A-Za-z0-9._~-]*|:[A-Za-z][A-Za-z0-9]*)$/;
const PLACEHOLDER = /\/:([A-Za-z][A-Za-z0-9]*)/g;
const FIRST_STATUS = 200;
const LAST_STATUS = 599;

/**
 * The path with each `:placeholder` replaced by `segment(name)`, which the caller has already made safe to put in a URL.
 * The one place that knows the placeholder syntax.
 */
export function fillPath(path: string, segment: (name: string) => string): string {
  return path.replace(PLACEHOLDER, (_whole, name: string) => `/${segment(name)}`);
}

/**
 * The placeholder names of a route path, in order: `/a/:x/b/:y` gives `['x', 'y']`.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export function pathParamNames(path: string): string[] {
  const names: string[] = [];
  fillPath(path, (name) => {
    names.push(name);
    return name;
  });
  return names;
}

/** The schema a route declares for `status`, or `undefined` when it declares none. */
export function responseSchemaFor(spec: RouteSpec, status: number): z.ZodType | undefined {
  return Object.entries(spec.responses).find(([key]) => Number(key) === status)?.[1];
}

/** The status codes a spec declares, as numbers. */
function statusesOf(spec: RouteSpec): number[] {
  return Object.keys(spec.responses).map(Number);
}

function checkPath(spec: RouteSpec): void {
  if (
    !spec.path.startsWith('/') ||
    !spec.path
      .slice(1)
      .split('/')
      .every((segment) => SEGMENT.test(segment))
  ) {
    throw new RangeError(`route path ${spec.path} is not a plain path of segments and :placeholders`);
  }
  const placeholders = pathParamNames(spec.path);
  const declared = spec.params === undefined ? [] : Object.keys(spec.params.shape);
  if (placeholders.length !== declared.length || !placeholders.every((name) => declared.includes(name))) {
    throw new RangeError(`route ${spec.method} ${spec.path}: params must name exactly the placeholders of the path`);
  }
}

function checkResponses(spec: RouteSpec): void {
  const statuses = statusesOf(spec);
  if (!statuses.every((status) => Number.isInteger(status) && status >= FIRST_STATUS && status <= LAST_STATUS)) {
    throw new RangeError(`route ${spec.method} ${spec.path}: a response status is an integer from 200 to 599`);
  }
  if (!statuses.some((status) => status < 300)) {
    throw new RangeError(`route ${spec.method} ${spec.path}: at least one success (2xx) response is needed`);
  }
}

function checkBody(spec: RouteSpec): void {
  if (spec.body !== undefined && (spec.method === 'GET' || spec.method === 'HEAD')) {
    throw new RangeError(`route ${spec.method} ${spec.path}: ${spec.method} carries no body`);
  }
}

/**
 * Defines a route. A descriptor that could never work is refused when the module loads: a path that is not plain, params
 * that are not the placeholders, no success response, a body on GET or HEAD. The spec keeps its literal types, so
 * `call(route, input)` of the web client is typed from the schemas.
 */
export function defineRoute<const Spec extends RouteSpec>(spec: Spec): Route<Spec> {
  checkPath(spec);
  checkResponses(spec);
  checkBody(spec);
  return Object.freeze({ ...spec, name: `${spec.method} ${spec.path}` as const });
}

/** The part of a call input for a request part: required when the schema needs a value, optional when `undefined` is valid, absent when the route has none. */
type Part<Key extends string, Schema> = Schema extends z.ZodType
  ? undefined extends z.input<Schema>
    ? Readonly<Partial<Record<Key, z.input<Schema>>>>
    : Readonly<Record<Key, z.input<Schema>>>
  : Readonly<Partial<Record<Key, undefined>>>;

/** What `call(route, input)` takes: the params, query and body the route declares, as their schemas accept them. */
export type CallInput<R extends RouteSpec> = Part<'params', R['params']> &
  Part<'query', R['query']> &
  Part<'body', R['body']>;

/** The success statuses (2xx) a route declares. */
type SuccessStatus<R extends RouteSpec> = Extract<keyof R['responses'], 200 | 201 | 202 | 203 | 204 | 205 | 206>;

/** What `call(route, ...)` resolves to: the parsed body of a success response, the union of them when there are several. */
export type SuccessOf<R extends RouteSpec> = {
  readonly [S in SuccessStatus<R>]: z.output<R['responses'][S]>;
}[SuccessStatus<R>];
