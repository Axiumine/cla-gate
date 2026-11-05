// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Dispatch, type SyntheticEvent, useState } from 'react';
import { normaliseRationale, type VersionBump } from '../../shared/cla-version.ts';
import type { DocumentIds } from './document-queries.ts';
import { affectedSignaturesOf, isRule } from './document-rules.ts';
import type { EditorAction, EditorState } from './editor-state.ts';
import { publishBody } from './publish-body.ts';
import { usePublishRequest } from './use-publish-request.ts';

/**
 * The form of the publish dialog (E18-S05). The kind of change is `major` and cannot be anything else while the document has no
 * version. The rationale is checked with the cleaning the server applies (`normaliseRationale`) before anything is sent. A `major`
 * publish over signatures is answered with their number: the form then asks for the confirmation and sends the same request again
 * with `acknowledgeResigning: true`.
 */
export function usePublish(ids: DocumentIds, revision: number, state: EditorState, dispatch: Dispatch<EditorAction>) {
  const [chosen, setChosen] = useState<VersionBump>('minor');
  const [rationale, setRationale] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const { send, mutation, affected } = usePublishRequest(ids, dispatch);
  const bump: VersionBump = state.active === null ? 'major' : chosen;
  const clean = normaliseRationale(rationale);
  const confirming = affected !== undefined && !acknowledged;
  const error = mutation.isError ? mutation.error : undefined;
  return {
    bump,
    setBump: setChosen,
    rationale,
    changeRationale: (text: string) => {
      setRationale(text);
      mutation.reset();
    },
    rationaleInvalid: (attempted && clean === null) || isRule(error, 'invalid_rationale'),
    affected,
    acknowledged,
    setAcknowledged,
    confirming,
    submit: (event: SyntheticEvent) => {
      event.preventDefault();
      setAttempted(true);
      if (clean !== null && !confirming) {
        send(
          publishBody({
            revision,
            bump,
            rationale: clean,
            activeVersionId: state.active?.id ?? null,
            acknowledgeResigning: acknowledged,
          }),
        );
      }
    },
    pending: mutation.isPending,
    failure: affectedSignaturesOf(error) === undefined && !isRule(error, 'invalid_rationale') ? error : undefined,
  };
}
