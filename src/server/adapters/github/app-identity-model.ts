// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import type { AccountType, AppResponse } from './schemas.ts';

/** What GitHub says about the App our credentials belong to (E05-S02). The owner id feeds the admission policy (E05-S07). */
export interface AppIdentity {
  readonly appId: GithubId;
  readonly slug: string;
  readonly ownerId: GithubId;
  readonly ownerType: AccountType;
  /** Permission name to level, for example `checks` to `write`. */
  readonly permissions: Readonly<Record<string, string>>;
}

/** The verified identity out of a `GET /app` answer; whatever the platform does not use is left behind. */
export function toAppIdentity(app: AppResponse): AppIdentity {
  return {
    appId: app.id,
    slug: app.slug,
    ownerId: app.owner.id,
    ownerType: app.owner.type,
    permissions: app.permissions,
  };
}
