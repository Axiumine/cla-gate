// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { createElement } from 'react';
import type { z } from 'zod';
import {
  activeVersionSchema,
  claDraftSchema,
  claListedDocumentSchema,
  DOCUMENT_PATH,
  DOCUMENTS_PATH,
  DRAFT_PATH,
  documentDetailResponseSchema,
  documentListResponseSchema,
  VERSION_PATH,
} from '../../shared/cla.ts';
import { versionDetailSchema } from '../../shared/cla-history.ts';
import { publishVersionResponseSchema } from '../../shared/cla-version.ts';
import { envelope, json, type Seen } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { serveTenants, summary, type Tenant, tenantOf } from '../installations/test-support.ts';
import { AppRouter } from '../router.tsx';
import { renderWithProviders } from '../test-support/render.tsx';
import { server } from '../test-support/server.ts';
import { ALICE } from '../test-support/session.ts';

// The server of the document screens, as MSW answers for it in the tests of E18-S05: the list, one document, its draft, the text of
// its active version, and the writes (create, save, discard, publish), every request recorded with its body. The values are made up.

type ListedInput = z.input<typeof claListedDocumentSchema>;
type VersionInput = z.input<typeof activeVersionSchema>;

/** The active version 1.0 of the documents below, published on a day in the past. */
const VERSION_1_0: VersionInput = {
  id: 301,
  major: 1,
  minor: 0,
  contentSha256: 'a'.repeat(64),
  publishedAt: '2026-10-01T09:30:00.000Z',
};

/** A version as the API sends it: `overrides` are put over 1.0 and the contract is checked. */
export function versionOf(overrides: Partial<VersionInput> = {}) {
  return activeVersionSchema.parse({ ...VERSION_1_0, ...overrides });
}

/** A document of the whole installation with the active version 1.0 and no draft; `overrides` change it and the contract is checked. */
export function listedOf(overrides: Partial<ListedInput> = {}) {
  return claListedDocumentSchema.parse({
    id: 11,
    name: 'Individual CLA',
    kind: 'individual',
    scope: 'installation',
    repositoryId: null,
    repositoryFullName: null,
    activeVersion: VERSION_1_0,
    hasDraft: false,
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-10-01T09:30:00.000Z',
    ...overrides,
  });
}

/** A document that has no version yet. */
export const unpublished = (overrides: Partial<ListedInput> = {}) => listedOf({ activeVersion: null, ...overrides });

/** The answer of `GET .../documents`. */
export const listOf = (...documents: ReturnType<typeof listedOf>[]): Response =>
  json(documentListResponseSchema.parse({ documents, nextCursor: null }));

/** The answer of `GET .../documents/:documentId`: the document without the name of its repository, which the schema leaves out. */
export const detailOf = (document: ReturnType<typeof listedOf> = listedOf()): Response =>
  json(documentDetailResponseSchema.parse({ document }));

/** The answer of `GET .../draft`: the draft at `revision` with `contentMd`, or none. */
export const draftOf = (contentMd: string | null, revision = 3): Response =>
  json({
    draft:
      contentMd === null ? null : claDraftSchema.parse({ contentMd, revision, updatedAt: '2026-10-02T10:00:00.000Z' }),
  });

/** The answer of `PUT .../draft`. */
export const savedAt = (revision: number): Response =>
  json({ draft: { revision, updatedAt: '2026-10-03T11:00:00.000Z' } });

/** The answer of `POST .../versions`: version `major.minor`, and whether and how many signatures it makes outdated. */
export function publishedAs(major: number, minor: number, signatures = 0, requiresResigning = false): Response {
  return json(
    publishVersionResponseSchema.parse({
      version: versionOf({ id: 400 + major * 10 + minor, major, minor, contentSha256: 'b'.repeat(64) }),
      requiresResigning,
      affectedSignatures: signatures,
    }),
    201,
  );
}

/** What the server answers when an admin has to confirm that signers sign again: the number of signatures of the current major. */
export const resignRequired = (signatures: number): Response =>
  envelope(409, 'resign_confirmation_required', {}, { affectedSignatures: signatures });

/** `204 No Content`. */
export const noContent = (): Response => new Response(null, { status: 204 });

/** What the server answers for one call: a response, or a function that makes one (it may wait). */
type Answer = Response | (() => Response | Promise<Response>);

/** What a test says the server answers; each list is the answers to the 1st, 2nd, ... request, and the last one repeats. */
export interface Serve {
  readonly tenants?: readonly Tenant[];
  readonly list?: readonly Answer[];
  readonly detail?: readonly Answer[];
  readonly draft?: readonly Answer[];
  /** The text of the active version, whatever its id. */
  readonly activeText?: string;
  readonly version?: readonly Answer[];
  readonly save?: readonly Answer[];
  readonly discard?: readonly Answer[];
  readonly publish?: readonly Answer[];
  readonly create?: readonly Answer[];
}

/** Every request the screens made to the server, in order, by endpoint. */
export interface Served {
  readonly list: Seen[];
  readonly detail: Seen[];
  readonly draft: Seen[];
  readonly version: Seen[];
  readonly save: Seen[];
  readonly discard: Seen[];
  readonly publish: Seen[];
  readonly create: Seen[];
  /** The requests of the installation screens: the list of installations and the repositories. */
  readonly tenants: ReturnType<typeof serveTenants>;
}

async function answerWith(answer: Answer): Promise<Response> {
  return typeof answer === 'function' ? await answer() : answer.clone();
}

/** What the next request is answered with: the one for its turn, the last one when there are fewer answers than requests. */
async function nth(answers: readonly Answer[], turn: number): Promise<Response> {
  const answer = answers[Math.min(turn, answers.length) - 1];
  return answer === undefined ? HttpResponse.error() : await answerWith(answer);
}

async function record(request: Request): Promise<Seen> {
  return {
    method: request.method,
    url: request.url,
    headers: Object.fromEntries(request.headers),
    text: await request.text(),
  };
}

/** The JSON a request carried, as the server read it. */
export const bodyOf = (seen: Seen | undefined): unknown => JSON.parse(String(seen?.text));

/** The text of the version the editor asks for when a document has an active version: made-up CLA text, not legal text. */
export const ACTIVE_TEXT = '# Zzzz agreement\n\nThe text of version 1.0.';

/** The answers of the endpoints when a test says nothing: the document `Individual CLA` at 1.0, no draft, a save at revision 4, a discard, a publish of 2.0. */
function defaultAnswers() {
  const document = listedOf();
  return {
    list: [listOf(document)],
    detail: [detailOf(document)],
    draft: [draftOf(null)],
    save: [savedAt(4)],
    discard: [noContent()],
    publish: [publishedAs(2, 0)],
    create: [json({ document: { ...document, id: 12, activeVersion: null } }, 201)],
  };
}

/** A handler that records each request in `seen` and answers it with the answer for its turn. */
function endpoint(seen: Seen[], answers: readonly Answer[]) {
  return async ({ request }: { readonly request: Request }) => {
    seen.push(await record(request));
    return await nth(answers, seen.length);
  };
}

/**
 * Serves the document endpoints of one tenant (and the installation screens' own, for the role and the repositories) with the answers
 * `serve` gives, or the defaults. `GET .../versions/:versionId` answers with the active version's text whatever the id.
 */
export function serveDocuments(serve: Serve = {}): Served {
  const answers = { ...defaultAnswers(), ...serve };
  const served: Served = {
    list: [],
    detail: [],
    draft: [],
    version: [],
    save: [],
    discard: [],
    publish: [],
    create: [],
    tenants: serveTenants(serve.tenants ?? [tenantOf(summary(), 'acme/widgets', 'acme/gadgets')]),
  };
  const versionAnswers = serve.version ?? [() => json({ version: versionBody(serve.activeText ?? ACTIVE_TEXT) })];
  server.use(
    http.get(DOCUMENTS_PATH, endpoint(served.list, answers.list)),
    http.post(DOCUMENTS_PATH, endpoint(served.create, answers.create)),
    http.get(DOCUMENT_PATH, endpoint(served.detail, answers.detail)),
    http.get(DRAFT_PATH, endpoint(served.draft, answers.draft)),
    http.put(DRAFT_PATH, endpoint(served.save, answers.save)),
    http.delete(DRAFT_PATH, endpoint(served.discard, answers.discard)),
    http.get(VERSION_PATH, endpoint(served.version, versionAnswers)),
    http.post(`${DOCUMENT_PATH}/versions`, endpoint(served.publish, answers.publish)),
  );
  return served;
}

/** A version with its text, as `GET .../versions/:versionId` sends it. */
function versionBody(contentMd: string) {
  return versionDetailSchema.parse({
    ...VERSION_1_0,
    publishedBy: { githubId: 4711, login: 'octocat' },
    rationale: 'First version',
    active: true,
    signatureCount: 0,
    contentMd,
  });
}

/** The app at `route`, signed in as the test user. */
export function renderDocuments(route: string) {
  return renderWithProviders(createElement(AppRouter), { route, session: ALICE });
}

export const LIST_ROUTE = '/installations/5/documents';
export const EDITOR_ROUTE = '/installations/5/documents/11';

/** The h1 of the app, once it is there. */
export const heading = (name: string | RegExp) => screen.findByRole('heading', { level: 1, name });

/** The text field of the editor. */
export const editorField = () =>
  screen.getByRole<HTMLTextAreaElement>('textbox', { name: messages['editor.text.label'] });

/** A button by its visible name. */
export const button = (name: string) => screen.getByRole('button', { name });

/** Opens the editor of the default document and waits for its text to be there. */
export async function openEditor(serve: Serve = {}) {
  const served = serveDocuments(serve);
  const rendered = renderDocuments(EDITOR_ROUTE);
  await heading('Individual CLA');
  return { served, ...rendered };
}

/** Replaces the whole text of the editor with `text`, the way a person pastes over a selection. */
export async function replaceText(user: UserEvent, text: string): Promise<void> {
  await user.clear(editorField());
  await user.paste(text);
}

/** A response the test lets go of when it chooses: `answer` is what the server sends, `release()` sends it. */
export function held(answer: Response) {
  const gate = Promise.withResolvers<true>();
  return {
    answer: async () => {
      await gate.promise;
      return answer;
    },
    release: () => {
      gate.resolve(true);
    },
  };
}

/** The status region of the editor, where "Draft saved", "Draft discarded" and the like are said. */
export const statusRegion = (text: string) =>
  screen.findByText(text, { selector: '[role="status"] *, [role="status"]' });

/** The publish dialog, once it is open. */
export const publishDialog = () => screen.getByRole('dialog', { name: messages['publish.title'] });

/** The rationale field of the publish dialog (its label says it is required). */
export const rationaleField = () =>
  within(publishDialog()).getByRole('textbox', {
    name: `${messages['publish.rationale']} ${messages['common.required']}`,
  });

/** The "Publish version" button of the dialog. */
export const submitButton = () => within(publishDialog()).getByRole('button', { name: messages['publish.submit'] });

/** The text of the draft the publish tests open with: `abc`, whose canonical form `abc\n` has a well-known SHA-256. */
export const ABC_HASH = 'sha256:edeaaff3f1774ad2888673770c6d64097e391bc362d7d6fb34982ddf0efd18cb';

/** Opens the editor on a saved draft (`abc` at revision 3) and opens the publish dialog. */
export async function openPublish(serve: Serve = {}) {
  const opened = await openEditor({ draft: [draftOf('abc', 3)], ...serve });
  await opened.user.click(button(messages['editor.publish']));
  await screen.findByRole('dialog', { name: messages['publish.title'] });
  return opened;
}
