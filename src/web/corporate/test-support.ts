// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { HttpResponse, http } from 'msw';
import {
  CORPORATE_AGREEMENTS_PATH,
  CORPORATE_DOCUMENT_PATH,
  type CorporateAgreement,
  type CorporateAgreementPage,
  type CorporateDocumentResponse,
} from '../../shared/corporate.ts';
import { CORPORATE_AVAILABILITY_PATH, CORPORATE_CLAIMS_PATH } from '../../shared/corporate-claims.ts';
import { server } from '../test-support/server.ts';

// Made-up answers and handlers for the tests of the two corporate pages (E21-S02). Nothing here is a real company or person.

/** GitHub's id of the repository of {@link DOCUMENT}. */
export const REPO_ID = 4242;

/** The corporate CLA in force for the repository {@link REPO_ID}. */
export const DOCUMENT: CorporateDocumentResponse = {
  repository: { githubRepoId: REPO_ID, fullName: 'acme/widgets' },
  document: { id: 11, name: 'Acme corporate CLA' },
  versionId: 21,
  major: 1,
  minor: 0,
  contentMd: '# Corporate terms\n\nThe company grants a licence to its contributions.\n',
  contentSha256: 'a'.repeat(64),
  publishedAt: '2026-10-01T09:00:00.000Z',
  consent: { id: 'corporate-v1', text: 'I sign this agreement for the company named above.' },
};

/** One agreement as the list sends it; `change` replaces fields. */
export function agreementWith(id: number, change: Partial<CorporateAgreement> = {}): CorporateAgreement {
  return {
    id,
    signatureId: id + 100,
    signedAt: '2026-10-02T10:30:00.000Z',
    major: 1,
    companyName: `Company ${id}`,
    signatoryTitle: `Title ${id}`,
    document: { id: 11, name: 'Acme corporate CLA' },
    installation: { accountLogin: 'acme-org' },
    activeApprovalCount: 2,
    revoked: false,
    ...change,
  };
}

/** The answer of the document route for the path of the test: the document, a failure with this code and status, or an unexpected one. */
export function answerDocument(answer: CorporateDocumentResponse | { status: number; code: string }): void {
  server.use(
    http.get(CORPORATE_DOCUMENT_PATH, () =>
      'status' in answer
        ? HttpResponse.json(
            { error: { code: answer.code, message: 'x', requestId: 'req-doc' } },
            { status: answer.status },
          )
        : HttpResponse.json(answer),
    ),
  );
}

/** The answer of the list route: each call takes the next page of `pages`, and the requests are recorded in the returned list. */
export function answerAgreements(pages: readonly CorporateAgreementPage[]): URL[] {
  const requests: URL[] = [];
  server.use(
    http.get(CORPORATE_AGREEMENTS_PATH, ({ request }) => {
      requests.push(new URL(request.url));
      const page = pages[Math.min(requests.length, pages.length) - 1];
      return HttpResponse.json(page);
    }),
  );
  return requests;
}

/** What `POST /api/corporate/agreements` received. */
export interface Posted {
  readonly csrf: string | null;
  readonly body: unknown;
}

/** The answer of the signing route: `201` with an agreement, or a failure with this status and code. The requests are recorded in the returned list. */
export function answerSigning(failure?: { status: number; code: string }): Posted[] {
  const posted: Posted[] = [];
  server.use(
    http.post(CORPORATE_AGREEMENTS_PATH, async ({ request }) => {
      posted.push({ csrf: request.headers.get('x-csrf-token'), body: await request.json() });
      return failure === undefined
        ? HttpResponse.json(
            {
              agreement: {
                id: 7,
                signatureId: 107,
                versionId: DOCUMENT.versionId,
                major: 1,
                signedAt: '2026-10-03T08:00:00.000Z',
              },
            },
            { status: 201 },
          )
        : HttpResponse.json(
            { error: { code: failure.code, message: 'x', requestId: 'req-sign' } },
            { status: failure.status },
          );
    }),
  );
  return posted;
}

/** The answer of the availability route for the path of the test: whether the repository offers the claim, or a failure with this status and code. */
export function answerAvailability(answer: boolean | { status: number; code: string }): void {
  server.use(
    http.get(CORPORATE_AVAILABILITY_PATH, () =>
      typeof answer === 'boolean'
        ? HttpResponse.json({ corporateAvailable: answer })
        : HttpResponse.json(
            { error: { code: answer.code, message: 'x', requestId: 'req-availability' } },
            { status: answer.status },
          ),
    ),
  );
}

/** What the claim route answers: a status of the success (`201 covered`, `200 already_covered`), or a failure with this status and code. */
export type ClaimAnswer = 'covered' | 'already_covered' | { status: number; code: string };

/** The answer of the claim route; the requests it receives are recorded in the returned list, with the CSRF token each carried. */
export function answerClaim(answer: ClaimAnswer): Posted[] {
  const posted: Posted[] = [];
  server.use(
    http.post(CORPORATE_CLAIMS_PATH, async ({ request }) => {
      posted.push({ csrf: request.headers.get('x-csrf-token'), body: await request.json() });
      if (typeof answer === 'string') {
        return HttpResponse.json({ status: answer }, { status: answer === 'covered' ? 201 : 200 });
      }
      return HttpResponse.json(
        { error: { code: answer.code, message: 'x', requestId: 'req-claim' } },
        { status: answer.status },
      );
    }),
  );
  return posted;
}
