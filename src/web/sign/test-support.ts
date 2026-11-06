// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { http } from 'msw';
import { createElement } from 'react';
import { expect } from 'vitest';
import type { z } from 'zod';
import { type signResponseSchema, signRoute } from '../../shared/sign.ts';
import { type SignContextResponse, signContextResponseSchema, signContextRoute } from '../../shared/sign-context.ts';
import { answer, envelope, json, type Seen } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { AppRouter } from '../router.tsx';
import { renderWithProviders } from '../test-support/render.tsx';
import { server } from '../test-support/server.ts';
import { ALICE } from '../test-support/session.ts';

// The server of the sign page, as MSW answers for it in the tests of the screen (E18-S01): the context of a repository and the
// answer to the sign request, each recorded. All values are made up.

/** The consent sentence of E13-S01 is the server's; the tests use a stand-in so they say what they mean by it. */
const CONSENT_TEXT = 'I have read this agreement and I agree to be bound by it (test sentence).';

/** The SHA-256 of the made-up text: 64 lowercase hexadecimal characters, the first 12 of them easy to find. */
export const SHA = '0123456789abcdef'.repeat(4);

/** The CLA of the fixture: a heading, a placeholder, a link and a list, in the source form that is stored and hashed. */
const CLA_SOURCE = [
  '# Individual Contributor Agreement',
  '',
  'This agreement is between you and <company name>.',
  '',
  '## 1. Grant',
  '',
  'Read [the policy](https://example.org/policy) first.',
  '',
  '- one',
  '- two',
].join('\n');

type ContextInput = z.input<typeof signContextResponseSchema>;

/** The context the server answers for a repository with a CLA, a signed-in person with one verified address and no signature. */
export function contextOf(overrides: Partial<ContextInput> = {}): SignContextResponse {
  const base: ContextInput = {
    repository: { githubRepoId: 123, fullName: 'acme/widgets', accountLogin: 'acme' },
    document: { id: 7, name: 'Individual CLA' },
    version: {
      id: 31,
      major: 2,
      minor: 1,
      contentMd: CLA_SOURCE,
      contentSha256: SHA,
      rationale: 'Clarified the patent grant',
      publishedAt: '2026-11-01T10:00:00.000Z',
    },
    consent: { id: 'individual-v1', text: CONSENT_TEXT },
    emails: [{ email: 'ada@example.org', primary: true }],
    viewer: { githubId: 4711, login: 'octocat' },
    pr: 45,
    prUrl: 'https://github.com/acme/widgets/pull/45',
    state: 'ready',
    signature: null,
    revoked: null,
    canSign: true,
    blockedReason: null,
  };
  return signContextResponseSchema.parse({ ...base, ...overrides });
}

/** U+202E, the right-to-left override; U+2028, the line separator; U+0007, a control. Built from code points: written out they would vanish. */
const RLO = String.fromCodePoint(0x202e);
const LINE_SEPARATOR = String.fromCodePoint(0x2028);
const BELL = String.fromCodePoint(0x07);
const LONE_SURROGATE = String.fromCharCode(0xd800);
/** Zero width space, zero width joiner and the Braille blank: three characters, none of which can be seen. */
const INVISIBLE = String.fromCodePoint(0x200b, 0x200d, 0x2800);

/** Names the shared rules refuse (E13-S03), each with what is wrong with it: the form and the schema must agree on all of them. */
export const REFUSED_NAMES: readonly (readonly [what: string, name: string])[] = [
  ['a control character', `Ada${BELL}Lovelace`],
  ['a right-to-left override', `Ada${RLO}Lovelace`],
  ['a line separator', `Ada${LINE_SEPARATOR}Lovelace`],
  ['a lone surrogate', `Ada${LONE_SURROGATE}`],
  ['no character that can be seen', INVISIBLE],
  ['201 characters', 'n'.repeat(201)],
];

/** Two addresses, the second of them the primary one. */
export const TWO_EMAILS: ContextInput['emails'] = [
  { email: 'ada@example.org', primary: false },
  { email: 'lovelace@example.net', primary: true },
];

type SignAnswer = z.input<typeof signResponseSchema>;

/** The answer to the sign request for a signature recorded now (201) or found already (200). */
export function signedAnswer(created: boolean, signature: Partial<SignAnswer['signature']> = {}): Response {
  const body: SignAnswer = {
    signature: { id: 900, versionId: 31, major: 2, minor: 1, signedAt: '2026-11-02T09:30:00.000Z', ...signature },
    created,
  };
  return json(body, created ? 201 : 200);
}

/** What the server answers with; a test names what it changes. */
export interface SignAnswers {
  readonly context?: Response;
  readonly sign?: Response;
}

/** The requests each route received, in order. */
export interface SignCalls {
  readonly context: Seen[];
  readonly sign: Seen[];
}

/** A server with a CLA for the repository: it answers the context, and the sign request with a new signature, unless told otherwise. */
export function serveSign(answers: SignAnswers = {}): SignCalls {
  return {
    context: answer(signContextRoute.path, answers.context ?? json(contextOf())),
    sign: answer(signRoute.path, answers.sign ?? signedAnswer(true)),
  };
}

/** The context as a response. */
export function contextResponse(overrides: Partial<ContextInput> = {}): Response {
  return json(contextOf(overrides));
}

/** The error body of the API with its status. */
export function failure(status: number, code: string, headers: Record<string, string> = {}): Response {
  return envelope(status, code, headers);
}

/** The context request, from now on, is answered when the test says so: `release` sends the answer. */
export function serveHeldContext(): { readonly release: (response: Response) => void } {
  const { promise: held, resolve: release } = Promise.withResolvers<Response>();
  server.use(http.get(signContextRoute.path, async () => (await held).clone()));
  return { release };
}

/** A sign request that is answered when the test says so: `release` sends the answer, and `received` lists what arrived. */
export function serveHeldSign(): { readonly received: Seen[]; readonly release: (response: Response) => void } {
  const received: Seen[] = [];
  const { promise: held, resolve: release } = Promise.withResolvers<Response>();
  server.use(
    http.post(signRoute.path, async ({ request }) => {
      received.push({
        method: request.method,
        url: request.url,
        headers: Object.fromEntries(request.headers),
        text: await request.text(),
      });
      return (await held).clone();
    }),
  );
  return { received, release };
}

/** The route of the sign page of repository 123 and pull request 45, the link the pull request comment carries. */
/** Where the sign context of the fixture repository and pull request sits in the query cache (see sign-queries.test.ts). */
export const CONTEXT_KEY = ['sign', 'context', 123, 45] as const;

const SIGN_ROUTE = '/sign/123?pr=45';

/** The app at `route`, signed in as the test user. */
export function renderSign(route = SIGN_ROUTE) {
  return renderWithProviders(createElement(AppRouter), { route, session: ALICE });
}

/** The app at `route` with nobody logged in: the session endpoint answers 401. */
export function renderSignAnonymous(route = SIGN_ROUTE) {
  return renderWithProviders(createElement(AppRouter), { route });
}

/** The main region of the page: the shell has live regions and links of its own, so a state is looked for here. */
export const pageMain = () => screen.getByRole('main');

/** The signature a person made under major version 1: what the context holds for someone who must sign major 2. */
export const EARLIER_SIGNATURE = { id: 5, major: 1, minor: 0, signedAt: '2026-01-01T00:00:00.000Z' } as const;

/** The context of a person who must sign the new major version again. */
export function resignContext(overrides: Partial<ContextInput> = {}): Response {
  return contextResponse({ state: 'resign_required', signature: EARLIER_SIGNATURE, ...overrides });
}

/** The context of a person whose verified addresses GitHub did not report: they cannot sign yet. */
export function blockedContext(overrides: Partial<ContextInput> = {}): Response {
  return contextResponse({ emails: [], canSign: false, blockedReason: 'no_verified_email', ...overrides });
}

/** The SHA-256 of the text of the newer version: not `SHA`, so a request can be told apart by the hash it carries. */
export const NEWER_SHA = 'f'.repeat(64);

/** The version the CLA moves on to while a person reads: 2.2, with another text and hash. */
export function newerVersion(): SignContextResponse['version'] {
  return {
    ...contextOf().version,
    id: 32,
    minor: 2,
    contentSha256: NEWER_SHA,
    contentMd: '# Individual Contributor Agreement\n\nThe newer text.',
  };
}

/** The app on the sign page, signed in as the test user, waiting for the document name. */
export async function openSignPage(route = SIGN_ROUTE) {
  const rendered = renderSign(route);
  await screen.findByRole('heading', { level: 1 });
  return rendered;
}

/** Presses Tab until `element` has focus; it fails when the element is not reached within `limit` presses. */
export async function tabTo(user: UserEvent, element: HTMLElement, limit = 40): Promise<void> {
  await user.tab();
  if (document.activeElement !== element && limit > 1) {
    await tabTo(user, element, limit - 1);
  }
}

/** The sign form: the controls a person fills. */
export const consentBox = () => screen.getByRole('checkbox', { name: (name) => name.startsWith(CONSENT_TEXT) });
export const nameInput = () =>
  screen.getByRole('textbox', { name: (name) => name.startsWith(messages['sign.name.label']) });
export const signButton = () => screen.getByRole('button', { name: messages['sign.submit'] });
export const emailChoice = (email: string) => screen.getByRole('radio', { name: (name) => name.startsWith(email) });

/** Ticks the consent box and types the name; the one address is already chosen when there is exactly one. */
export async function fillForm(user: UserEvent, name = 'Ada Lovelace'): Promise<void> {
  await user.click(consentBox());
  await user.click(nameInput());
  await user.paste(name);
}

/** The confirmation that replaces the form. */
export const confirmation = () => screen.findByRole('heading', { level: 2, name: messages['sign.done.title'] });

/** The page opened and the form filled, not yet sent. */
export async function openFilled(route = SIGN_ROUTE, name = 'Ada Lovelace') {
  const opened = await openSignPage(route);
  await fillForm(opened.user, name);
  return opened;
}

/** The held answer is sent, the confirmation is waited for, and the server is shown to have had exactly one request. */
export async function releaseAndConfirm(held: ReturnType<typeof serveHeldSign>): Promise<void> {
  held.release(signedAnswer(true));
  await confirmation();
  expect(held.received).toHaveLength(1);
}

/** The form filled and the button pressed, once the server has the request. */
export async function signUp(calls: SignCalls, route = SIGN_ROUTE, name = 'Ada Lovelace') {
  const opened = await openFilled(route, name);
  await opened.user.click(signButton());
  await waitFor(() => {
    expect(calls.sign).toHaveLength(1);
  });
  return opened;
}

/** The form filled and the button pressed, once the confirmation is there. */
export async function signThrough(route = SIGN_ROUTE, name = 'Ada Lovelace') {
  const opened = await openFilled(route, name);
  await opened.user.click(signButton());
  return { ...opened, heading: await confirmation() };
}

/** The body of the first of the recorded sign requests, parsed: `undefined` when none arrived. */
export function bodyOf(seen: readonly Seen[]): unknown {
  return seen.map((request): unknown => JSON.parse(request.text))[0];
}
