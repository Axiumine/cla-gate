// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { EraseAction } from './erase/EraseAction.tsx';
import { RevokeAction } from './RevokeAction.tsx';
import { SignatureDetails } from './SignatureDetails.tsx';
import type { EraseControl, RevokeControl } from './SignaturesTable.tsx';
import type { Signature } from './signature-queries.ts';

export interface SignatureActionsProps {
  readonly item: Signature;
  /** The revocation of the rows the viewer may revoke. */
  readonly revoke: RevokeControl;
  /** The erasure of personal data on every row, for an org admin; absent for any other viewer. */
  readonly erase: EraseControl | undefined;
}

/**
 * The last cell of a row of the signatures (E18-S07, E18-S14): "Details" on every row, "Revoke" when the viewer may revoke the signatures of
 * the document of the row, and "Erase personal data" for an org admin. Each button opens a dialog of its own and names the signer.
 */
export function SignatureActions({ item, revoke, erase }: SignatureActionsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <SignatureDetails item={item} />
      {revoke.allowed(item.document.id) ? (
        <RevokeAction
          installationId={revoke.installationId}
          item={item}
          suspended={revoke.suspended}
          onOutcome={revoke.onOutcome}
          onVanished={revoke.onVanished}
        />
      ) : null}
      {erase === undefined ? null : (
        <EraseAction
          installationId={erase.installationId}
          item={item}
          suspended={erase.suspended}
          onDone={erase.onDone}
        />
      )}
    </div>
  );
}
