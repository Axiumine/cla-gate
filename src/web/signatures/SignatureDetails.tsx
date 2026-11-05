// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ReactNode } from 'react';
import { useT } from '../i18n/index.ts';
import { Timestamp } from '../i18n/Timestamp.tsx';
import { Badge, Button, Dialog, UserText } from '../ui/index.ts';
import { visibleText } from '../ui/user-text.ts';
import { GithubIdCell, SourceCell } from './SignatureCells.tsx';
import type { Signature } from './signature-queries.ts';
import { signerSubject } from './signer-subject.ts';

/** One line of the detail: a term and what it is. */
function Fact({ term, children }: { readonly term: string; readonly children: ReactNode }) {
  return (
    <>
      <dt className="font-medium">{term}</dt>
      <dd>{children}</dd>
    </>
  );
}

/** What a row has beyond the table: the personal data the signer gave and, for a revoked signature, who revoked it, when and why. */
function Facts({ item }: { readonly item: Signature }) {
  const t = useT();
  const { signer } = item;
  const erased = <span className="text-fg-muted">{t('signatures.signer.erased')}</span>;
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
      <Fact term={t('signatures.details.name')}>{signer === null ? erased : <UserText>{signer.name}</UserText>}</Fact>
      <Fact term={t('signatures.details.login')}>{signer === null ? erased : <UserText>{signer.login}</UserText>}</Fact>
      <Fact term={t('signatures.details.email')}>{signer === null ? erased : <UserText>{signer.email}</UserText>}</Fact>
      <Fact term={t('signatures.col.githubId')}>
        <GithubIdCell item={item} />
      </Fact>
      <Fact term={t('signatures.col.document')}>
        <UserText>{item.document.name}</UserText>
      </Fact>
      <Fact term={t('signatures.col.version')}>
        {item.version.major}.{item.version.minor}
      </Fact>
      <Fact term={t('signatures.col.signed')}>
        <Timestamp value={item.signedAt} utc />
      </Fact>
      <Fact term={t('signatures.col.source')}>
        <SourceCell item={item} />
      </Fact>
      <Fact term={t('signatures.col.status')}>
        <Badge status={item.state} />
      </Fact>
      {item.revokedAt === null || item.revokedByGithubId === null || item.revokeReasonCode === null ? null : (
        <>
          <Fact term={t('signatures.details.revokedAt')}>
            <Timestamp value={item.revokedAt} utc />
          </Fact>
          <Fact term={t('signatures.details.revokedBy')}>
            <code>{item.revokedByGithubId}</code>
          </Fact>
          <Fact term={t('signatures.details.revokedReason')}>
            {t(`signatures.revoke.reason.${item.revokeReasonCode}`)}
          </Fact>
        </>
      )}
    </dl>
  );
}

/**
 * "Details" on one row (E18-S07): a dialog with everything the signer gave and, when the signature is revoked, who revoked it, when and
 * why. It is the one place of the screen that shows the verified email address. Everything the signer typed goes through `UserText`,
 * the title included, so a hostile name stays text.
 */
export function SignatureDetails({ item }: { readonly item: Signature }) {
  const t = useT();
  const subject = signerSubject(item, t);
  return (
    <Dialog
      title={
        <>
          {t('signatures.details.title')} <UserText>{subject}</UserText>
        </>
      }
      description={t('signatures.details.description')}
      trigger={
        <Button aria-label={t('signatures.details.label', { signer: visibleText(subject) })}>
          {t('signatures.details')}
        </Button>
      }
    >
      <Facts item={item} />
    </Dialog>
  );
}
