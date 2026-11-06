// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Timestamp } from '../i18n/Timestamp.tsx';
import { UserText } from '../ui/index.ts';
import { actionLabelKey, knownAction } from './audit-actions.ts';
import type { AuditEvent } from './audit-queries.ts';

// The cells of the audit table (E18-S09), one small component for each, so the table reads as its columns.

/** When the event happened (UTC), and its number, which a person can quote. */
export function TimeCell({ event }: { readonly event: AuditEvent }) {
  const t = useT();
  return (
    <>
      <Timestamp value={event.occurredAt} utc />
      <span className="block text-xs text-fg-muted">{t('audit.event.id', { id: event.id })}</span>
    </>
  );
}

/**
 * Who did it: the numeric GitHub id in `<code>`, and the login snapshot through `UserText` when the instance holds one. An event that
 * no person caused (a webhook, a schedule) has no actor and says "System".
 */
export function ActorCell({ event }: { readonly event: AuditEvent }) {
  const t = useT();
  const { actor } = event;
  if (actor === null) {
    return <span>{t('audit.actor.system')}</span>;
  }
  return (
    <>
      <code>{actor.githubId}</code>
      {actor.login === null ? null : (
        <>
          {' '}
          <UserText>{actor.login}</UserText>
        </>
      )}
    </>
  );
}

/** What was done: the label of an action of the catalogue, else the code as the server sent it, in `<code>`. */
export function ActionCell({ event }: { readonly event: AuditEvent }) {
  const t = useT();
  const action = knownAction(event.action);
  return action === undefined ? (
    <code>
      <UserText>{event.action}</UserText>
    </code>
  ) : (
    <span>{t(actionLabelKey(action))}</span>
  );
}

/** What it was done to: the kind of record and its number in `<code>`, or "None" for an event about no record. */
export function SubjectCell({ event }: { readonly event: AuditEvent }) {
  const t = useT();
  const { subject } = event;
  if (subject === null) {
    return <span>{t('audit.subject.none')}</span>;
  }
  return (
    <>
      <UserText>{subject.type}</UserText> <code>{subject.id}</code>
    </>
  );
}
