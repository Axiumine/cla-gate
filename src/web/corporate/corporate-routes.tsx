// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { createRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { rootRoute } from '../root-route.ts';
import { withAccess } from '../route-access.ts';
import { CorporateAgreementsPage } from './CorporateAgreementsPage.tsx';
import { CorporateSignPage } from './CorporateSignPage.tsx';
import { EmployerClaimPage } from './EmployerClaimPage.tsx';
import { RepositoryRoute } from './RepositoryRoute.tsx';

// The routes of the corporate CLA (E21-S02, E21-S04): the page where an authorised signatory signs for a company, the claim of an employee
// and the list of the agreements a person signed. All three need a login. The paths are those of CORPORATE_SIGN_PAGE_PATH,
// CORPORATE_CLAIM_PAGE_PATH and CORPORATE_AGREEMENTS_PAGE_PATH in the shared contract (TanStack spells a parameter `$name`; router.test.tsx
// holds the spellings together).

export const corporateSignRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/corporate/sign/$githubRepoId',
  ...withAccess('authenticated', { title: 'corporate.sign.title' }),
  component: function CorporateSignRoute() {
    return <RepositoryRoute githubRepoId={corporateSignRoute.useParams().githubRepoId} page={CorporateSignPage} />;
  },
});

// The claim of an employee (E21-S04): a page of its own at CORPORATE_CLAIM_PAGE_PATH, for a signed-in person and for the link a contributor is
// given; the page where a contributor signs embeds the same entry (EmployerClaim). An address that does not hold the id of a repository is the
// not-found page.
export const corporateClaimRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/corporate/claim/$githubRepoId',
  ...withAccess('authenticated', { title: 'corporate.claim.pageTitle' }),
  component: function CorporateClaimRoute() {
    return <RepositoryRoute githubRepoId={corporateClaimRoute.useParams().githubRepoId} page={EmployerClaimPage} />;
  },
});

/** `?cursor=` of the list: the opaque cursor of the page on screen, else the first page. The raw value goes no further. */
const corporateAgreementsSearch = z.object({ cursor: z.string().max(512).optional().catch(undefined) });

export const corporateAgreementsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/corporate/agreements',
  ...withAccess('authenticated', { title: 'corporate.agreements.title' }),
  validateSearch: corporateAgreementsSearch,
  component: function CorporateAgreementsRoute() {
    const { cursor } = corporateAgreementsRoute.useSearch();
    const navigate = corporateAgreementsRoute.useNavigate();
    return (
      <CorporateAgreementsPage
        cursor={cursor}
        onCursorChange={(next) => {
          void navigate({ search: { cursor: next } });
        }}
      />
    );
  },
});
