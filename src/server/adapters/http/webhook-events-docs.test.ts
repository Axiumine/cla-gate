// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { ROUTED_EVENTS, SUBSCRIBED_EVENTS } from '../../domain/webhook-routing.ts';
import { hasPayloadSchema } from '../github/webhook-schemas.ts';

// The events the router handles are the events the App is subscribed to (E06-S04). The document is the source of the
// list; this test reads its `Events` row, so a change to the subscription that does not reach the router fails here.

/** `names` in a fixed order, so two lists compare equal whatever order they were built in. */
function sorted(names: readonly string[]): string[] {
  return names.toSorted((a, b) => a.localeCompare(b));
}

/** The `Events` row of the settings table in `docs/github-app.md`. */
function eventsRow(): string {
  const row = readFileSync('docs/github-app.md', 'utf8')
    .split('\n')
    .find((line) => line.startsWith('| Events |'));
  expect(row, 'docs/github-app.md has no `| Events |` row').toBeDefined();
  return row ?? '';
}

/** The event names the row writes in code spans (`pull_request`); `/recheck` and the like are not names. */
function documentedEvents(row: string): string[] {
  return [...row.matchAll(/`([a-z_]+)`/g)].map((match) => match[1] ?? '');
}

test('SUBSCRIBED_EVENTS lists the event names of the Events row of docs/github-app.md, no more and no less', () => {
  expect(sorted([...new Set(documentedEvents(eventsRow()))])).toEqual(sorted(SUBSCRIBED_EVENTS));
});

test('every event of the Events row has a row in the routing table', () => {
  expect(sorted(ROUTED_EVENTS)).toEqual(sorted([...new Set(documentedEvents(eventsRow()))]));
});

test('every subscribed event has a payload schema (E06-S03), so the router never reads an unchecked payload', () => {
  expect(SUBSCRIBED_EVENTS.filter((event) => !hasPayloadSchema(event))).toEqual([]);
  expect(hasPayloadSchema('ping')).toBe(false);
});
