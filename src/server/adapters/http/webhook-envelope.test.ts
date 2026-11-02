// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { IncomingHttpHeaders } from 'node:http';
import { expect, test } from 'vitest';
import { AppError } from './errors.ts';
import { readEnvelope } from './webhook-envelope.ts';

const APP_ID = '123456';
const DELIVERY = '5b8f2c1e-3d4a-4f6b-9a7c-0e1d2f3a4b5c';
const BODY = Buffer.from('{"action":"opened"}');

/** A delivery's headers as Node hands them over, with `overrides` added (an `undefined` value removes a header). */
function headersWith(overrides: IncomingHttpHeaders = {}): IncomingHttpHeaders {
  return {
    'content-type': 'application/json',
    'x-github-event': 'pull_request',
    'x-github-delivery': DELIVERY,
    ...overrides,
  };
}

/** What `readEnvelope` throws, as the status and code a client would see, and the details it carries. */
function refusalFor(headers: IncomingHttpHeaders, appId: string | undefined) {
  try {
    readEnvelope(headers, BODY, appId);
  } catch (error) {
    if (error instanceof AppError) {
      return { status: error.status, code: error.code, details: error.details };
    }
    throw error;
  }
  return undefined;
}

/** The same, for the App the tests configure. */
function refusal(headers: IncomingHttpHeaders) {
  return refusalFor(headers, APP_ID);
}

test('a good delivery yields its event, its lower-case delivery id and the parsed object', () => {
  const upper = headersWith({ 'x-github-delivery': DELIVERY.toUpperCase() });
  expect(readEnvelope(upper, BODY, APP_ID)).toEqual({
    event: 'pull_request',
    deliveryId: DELIVERY,
    payload: { action: 'opened' },
  });
});

const EVENTS = [
  { label: 'missing', value: undefined },
  { label: 'empty', value: '' },
  { label: 'upper case', value: 'Pull_Request' },
  { label: 'a hyphen', value: 'pull-request' },
  { label: 'a space', value: 'pull request' },
  { label: 'a digit', value: 'pull_request2' },
  { label: 'a trailing newline', value: 'pull_request\n' },
  { label: '65 characters', value: 'a'.repeat(65) },
  { label: 'a repeated header, as Node joins it', value: 'pull_request, issue_comment' },
  { label: 'two values as an array', value: ['pull_request', 'issue_comment'] },
  { label: 'an array of one', value: ['pull_request'] },
];

test.each(EVENTS)('X-GitHub-Event $label is a 400 naming the header, not the value', ({ value }) => {
  expect(refusal(headersWith({ 'x-github-event': value }))).toEqual({
    status: 400,
    code: 'webhook_header_invalid',
    details: { header: 'X-GitHub-Event' },
  });
});

test.each([{ value: 'ping' }, { value: 'a' }, { value: '_' }, { value: 'a'.repeat(64) }])(
  'X-GitHub-Event $value is accepted',
  ({ value }) => {
    expect(readEnvelope(headersWith({ 'x-github-event': value }), BODY, APP_ID).event).toBe(value);
  },
);

const DELIVERIES = [
  { label: 'missing', value: undefined },
  { label: 'empty', value: '' },
  { label: 'not a UUID', value: 'delivery-1' },
  { label: 'a UUID without dashes', value: DELIVERY.replaceAll('-', '') },
  { label: 'a UUID with a trailing character', value: `${DELIVERY}0` },
  { label: 'a UUID with a trailing space', value: `${DELIVERY} ` },
  { label: 'a UUID with a trailing newline', value: `${DELIVERY}\n` },
  { label: 'a non-hex digit', value: DELIVERY.replace('5b8f', 'zb8f') },
  { label: 'a braced UUID', value: `{${DELIVERY}}` },
  { label: 'a repeated header, as Node joins it', value: `${DELIVERY}, ${DELIVERY}` },
  { label: 'two values as an array', value: [DELIVERY, DELIVERY] },
  { label: 'a very long value', value: 'a'.repeat(100_000) },
];

test.each(DELIVERIES)('X-GitHub-Delivery $label is a 400 naming the header, not the value', ({ value }) => {
  expect(refusal(headersWith({ 'x-github-delivery': value }))).toEqual({
    status: 400,
    code: 'webhook_header_invalid',
    details: { header: 'X-GitHub-Delivery' },
  });
});

test.each([
  { label: 'the nil UUID', id: '00000000-0000-0000-0000-000000000000' },
  { label: 'a version 1 UUID', id: 'a8098c1a-f86e-11da-bd1a-00112444be1e' },
  { label: 'upper case', id: 'ABCDEF01-2345-6789-ABCD-EF0123456789' },
])('X-GitHub-Delivery as $label is accepted and stored lower-case', ({ id }) => {
  expect(readEnvelope(headersWith({ 'x-github-delivery': id }), BODY, APP_ID).deliveryId).toBe(id.toLowerCase());
});

const OTHER_APP = [
  { label: 'another target id', headers: { 'x-github-hook-installation-target-id': '654321' } },
  { label: 'the id with a leading zero', headers: { 'x-github-hook-installation-target-id': '0123456' } },
  { label: 'the id with a trailing space', headers: { 'x-github-hook-installation-target-id': '123456 ' } },
  { label: 'a repeated target id', headers: { 'x-github-hook-installation-target-id': '123456, 123456' } },
  { label: 'an empty target id', headers: { 'x-github-hook-installation-target-id': '' } },
  { label: 'a target type of repository', headers: { 'x-github-hook-installation-target-type': 'repository' } },
  { label: 'a target type in upper case', headers: { 'x-github-hook-installation-target-type': 'INTEGRATION' } },
  { label: 'an empty target type', headers: { 'x-github-hook-installation-target-type': '' } },
  {
    label: 'the right id and the wrong type',
    headers: {
      'x-github-hook-installation-target-id': '123456',
      'x-github-hook-installation-target-type': 'organization',
    },
  },
  {
    label: 'the wrong id and the right type',
    headers: { 'x-github-hook-installation-target-id': '1', 'x-github-hook-installation-target-type': 'integration' },
  },
];

test.each(OTHER_APP)('$label is a 400 webhook_wrong_app with a hint for the operator', ({ headers }) => {
  const failure = refusal(headersWith(headers));
  expect(failure).toMatchObject({ status: 400, code: 'webhook_wrong_app' });
  expect(JSON.stringify(failure?.details)).toContain('another GitHub App');
});

test('a target id with no GITHUB_APP_ID configured matches nothing: the check fails closed', () => {
  const headers = headersWith({ 'x-github-hook-installation-target-id': APP_ID });
  expect(refusalFor(headers, undefined)).toMatchObject({ status: 400, code: 'webhook_wrong_app' });
});

test.each([
  { label: 'neither header', headers: {}, appId: APP_ID },
  { label: 'neither header and no configured App', headers: {}, appId: undefined },
  { label: 'the right id', headers: { 'x-github-hook-installation-target-id': APP_ID }, appId: APP_ID },
  { label: 'the right type', headers: { 'x-github-hook-installation-target-type': 'integration' }, appId: APP_ID },
])('$label is accepted', ({ headers, appId }) => {
  expect(refusalFor(headersWith(headers), appId)).toBeUndefined();
});

test.each([
  { label: 'a missing Content-Type', type: undefined },
  { label: 'an empty Content-Type', type: '' },
  { label: 'the form encoding GitHub offers', type: 'application/x-www-form-urlencoded' },
  { label: 'plain text', type: 'text/plain' },
  { label: 'text/json', type: 'text/json' },
  { label: 'a longer subtype', type: 'application/jsonx' },
  { label: 'a JSON suffix type', type: 'application/vnd.github+json' },
  { label: 'a JSON patch', type: 'application/json-patch+json' },
  { label: 'a list of types', type: 'application/json, text/plain' },
  { label: 'a multipart body', type: 'multipart/form-data; boundary=x' },
  { label: 'JSON hidden in a parameter', type: 'text/plain; x=application/json' },
])('$label is a 415 that tells the operator to set application/json', ({ type }) => {
  const failure = refusal(headersWith({ 'content-type': type }));
  expect(failure).toMatchObject({ status: 415, code: 'webhook_unsupported_media_type' });
  expect(JSON.stringify(failure?.details)).toContain('application/json');
  expect(JSON.stringify(failure?.details)).toContain('GitHub App settings');
});

test.each([
  { type: 'application/json' },
  { type: 'application/json; charset=utf-8' },
  { type: 'application/json;charset=UTF-8' },
  { type: 'application/json; charset=latin1' },
  { type: 'application/json;' },
  { type: 'Application/JSON' },
  { type: ' application/json ' },
])('Content-Type $type is accepted', ({ type }) => {
  expect(refusal(headersWith({ 'content-type': type }))).toBeUndefined();
});
