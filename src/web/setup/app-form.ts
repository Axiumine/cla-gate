// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type ManifestRequest, manifestRequestSchema } from '../../shared/setup.ts';

// The values of the App form and their check (E19-S07). The check is the shared schema of the manifest request itself
// (E19-S06), so the organisation login and the App name rules cannot drift from the server's.

export type OwnerType = 'user' | 'organisation';

export interface AppFormValues {
  readonly ownerType: OwnerType;
  readonly organisation: string;
  readonly appName: string;
  readonly allowOtherAccounts: boolean;
}

/** The fields that can be wrong. */
export type AppFormField = 'organisation' | 'appName';

export type AppFormCheck =
  | { readonly valid: true; readonly request: ManifestRequest }
  | { readonly valid: false; readonly wrong: ReadonlySet<AppFormField> };

/** The longest name GitHub accepts here; the default is cut to it. */
const MAX_NAME_LENGTH = 34;

/**
 * The App name offered at first: "CLA Gate <host>", with every run of characters the shared pattern does not allow in a name
 * (dots, colons, brackets) replaced by a hyphen, cut to 34 characters.
 */
export function defaultAppName(host: string): string {
  return `CLA Gate ${host}`.replace(/[^A-Za-z0-9 -]+/gu, '-').slice(0, MAX_NAME_LENGTH);
}

/** The request the values would send: a personal App carries no organisation, an organisation App must name one. */
function candidate(values: AppFormValues) {
  const { appName, allowOtherAccounts } = values;
  return values.ownerType === 'user'
    ? { ownerType: values.ownerType, appName, allowOtherAccounts }
    : { ownerType: values.ownerType, organisation: values.organisation, appName, allowOtherAccounts };
}

/** Checks `values` against the manifest request schema: the request to send, or the fields that are wrong. */
export function checkAppForm(values: AppFormValues): AppFormCheck {
  const result = manifestRequestSchema.safeParse(candidate(values));
  if (result.success) {
    return { valid: true, request: result.data };
  }
  const wrong = new Set<AppFormField>();
  for (const issue of result.error.issues) {
    wrong.add(issue.path[0] === 'organisation' ? 'organisation' : 'appName');
  }
  return { valid: false, wrong };
}
