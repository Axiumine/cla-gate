// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { useInstallations } from '../installations/use-installations.ts';
import { usePageSubject } from '../layout/page-subject.ts';
import { LoadingState } from '../states/LoadingState.tsx';
import { Heading } from '../ui/index.ts';
import { PendingTabs, type PendingTabsProps } from './PendingTabs.tsx';

/** What the page is given: the tabs know the rest (the role and whether the installation is suspended) from the list of installations. */
export type PendingPageProps = Omit<PendingTabsProps, 'role' | 'suspended'>;

/**
 * The page at `/installations/$installationId/pending` (E18-S08): the open pull requests that the CLA check blocks, and the commit
 * overrides of a repository, in two tabs. It waits for the list of installations, because the role decides what there is to
 * choose among (a repo admin has their repositories only) and a suspended installation turns the writes off; the server decides on every
 * request all the same. Every request is addressed through the installation on screen, or through a repository of it.
 */
export function PendingPage(props: PendingPageProps) {
  const t = useT();
  const installations = useInstallations();
  const installation = installations.data?.find((candidate) => candidate.id === props.installationId);
  usePageSubject(installation?.accountLogin);
  if (installations.isPending) {
    return <LoadingState />;
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Heading level={1}>{t('pending.title')}</Heading>
        <p className="max-w-prose text-fg-muted">{t('pending.intro')}</p>
      </div>
      <PendingTabs {...props} role={installation?.role} suspended={installation?.suspended === true} />
    </div>
  );
}
