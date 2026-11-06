// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { installationParamsSchema } from '../../shared/installations.ts';

// What the address of an installation holds (E18-S04): `/installations/$installationId`, the internal `installations.id`.

/** Decimal digits with no sign, no leading zero, no exponent and no space: the only spelling of an installation id the app writes. */
const PLAIN_NUMBER = /^[1-9]\d{0,15}$/;

/**
 * The installation id in the path, or `undefined` when the text is not one. The shape of the id is the one the API accepts (a
 * positive safe integer); `1e3`, `0x10`, ` 5` and `5.0` are not installation ids, and a path with one is no page of the app.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export function parseInstallationId(raw: string): number | undefined {
  if (!PLAIN_NUMBER.test(raw)) {
    return undefined;
  }
  const parsed = installationParamsSchema.shape.installationId.safeParse(Number(raw));
  return parsed.success ? parsed.data : undefined;
}

/**
 * The installation id among the parsed params of a matched route, or `undefined` when the route has none (the shell reads the
 * params of whatever route is showing, where TypeScript only knows that they are an object).
 */
export function installationIdOf(params: unknown): number | undefined {
  if (typeof params !== 'object' || params === null || !('installationId' in params)) {
    return undefined;
  }
  return typeof params.installationId === 'number' ? params.installationId : undefined;
}

/**
 * The `params` option of the route of an installation (E18-S04): a segment that is not a plain positive number is no page of the
 * app (the route does not match; `false` skips it), and the number is written back as it is read.
 */
export const installationRouteParams = {
  parse: ({ installationId }: { readonly installationId: string }) => {
    const parsed = parseInstallationId(installationId);
    return parsed === undefined ? false : { installationId: parsed };
  },
  stringify: ({ installationId }: { readonly installationId: number }) => ({ installationId: String(installationId) }),
} as const;
