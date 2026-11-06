// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type SyntheticEvent, useState } from 'react';
import { normaliseRationale, type VersionBump } from '../../shared/cla-version.ts';
import type { DocumentIds } from './document-queries.ts';
import { affectedSignaturesOf, isRule } from './document-rules.ts';
import { publishBody } from './publish-body.ts';
import { forcedMajorOf, type PublishTarget, sourceOf } from './publish-target.ts';
import { type PublishOutcomes, usePublishRequest } from './use-publish-request.ts';

/**
 * The form of the publish dialog (E18-S05), for the saved draft or, from the history, for a version to publish again (E18-S11). The
 * kind of change is `major` and cannot be anything else while the document has no version or when the text is a version of another
 * major than the active one (`forced`). The rationale is checked with the cleaning the server applies (`normaliseRationale`) before anything is sent. A `major`
 * publish over signatures is answered with their number: the form then asks for the confirmation and sends the same request again
 * with `acknowledgeResigning: true`.
 */
export function usePublish(ids: DocumentIds, target: PublishTarget, outcomes: PublishOutcomes) {
  const [chosen, setChosen] = useState<VersionBump>('minor');
  const [rationale, setRationale] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const { send, mutation, affected } = usePublishRequest(ids, outcomes);
  const forced = forcedMajorOf(target);
  const bump: VersionBump = forced === undefined ? chosen : 'major';
  const clean = normaliseRationale(rationale);
  const confirming = affected !== undefined && !acknowledged;
  const error = mutation.isError ? mutation.error : undefined;
  return {
    bump,
    forced,
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
            source: sourceOf(target.from),
            bump,
            rationale: clean,
            activeVersionId: target.active?.id ?? null,
            acknowledgeResigning: acknowledged,
          }),
        );
      }
    },
    pending: mutation.isPending,
    failure: affectedSignaturesOf(error) === undefined && !isRule(error, 'invalid_rationale') ? error : undefined,
  };
}
