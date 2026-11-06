// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import type { InstallationRole } from '../../shared/installations.ts';

// Who the screen offers revocation and export to (E18-S07). The server decides on every request; this only keeps the controls of
// something the person cannot do off the screen.

/** Where a CLA document applies: the whole installation, or one repository. */
export type DocumentScope = 'installation' | 'repository';

/**
 * Whether a person with `role` in the installation can revoke the signatures of, and export, a document of `scope`: an org admin
 * can for every document, a repo admin only for a document of a repository (the decision table of the server), and a person whose
 * role is not known cannot, so nothing is offered until the list of installations has said what they are. A document whose scope is
 * not known (an id that is only in the address) counts as a repository's for a repo admin, because the search lists no other to
 * them, and the server still refuses what is not theirs.
 */
export function canManage(role: InstallationRole | undefined, scope: DocumentScope | undefined): boolean {
  return role === 'org_admin' || (role === 'repo_admin' && scope !== 'installation');
}

/**
 * Whether a person with `role` in the installation is offered the erasure of a signer's personal data (E18-S14): an org admin only,
 * because the personal data of a person spans documents and repositories, so a repo admin is refused by the server (`403`) and a role
 * that is not known is offered nothing. The server decides on every request.
 */
export function canErase(role: InstallationRole | undefined): boolean {
  return role === 'org_admin';
}
