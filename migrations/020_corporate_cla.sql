-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 Giovanni Manzoni
--
-- 020_corporate_cla (E21-S01): the corporate CLA schema. Forward-only: never edit this file once merged, add a new migration
-- instead. Migrations 018 and 019 belong to another epic; 021 is the next one of this epic.
--
-- A company signs a corporate CLA once through an authorised signatory, who becomes its CLA manager and approves employees by
-- GitHub account (numeric id), verified email domain or GitHub org. The same rules as the signature core apply: the evidence is
-- immutable, a revocation is prospective, and personal data lives in tables of its own that erasure can delete.
--
--   * corporate_agreements: one row per signed corporate CLA. The signatory's consent is an ordinary `signatures` row with
--     signer_type 'corporate' (version id, text hash, consent text id, name/email/login in signer_pii), so the immutable core
--     is reused and not duplicated. The agreement points at that signature (UNIQUE) and repeats the installation, document and
--     major, which a BEFORE INSERT trigger holds equal to the signature's. Insert-only: UPDATE, DELETE and TRUNCATE are refused
--     (an agreement ends by revoking its signature, which is E15's revocation).
--   * corporate_agreement_pii (company name, signatory title) and corporate_approval_pii (login snapshot of an approved user or
--     org) hold the erasable text. No other table copies their values: audit_log metadata and pr_evaluations.details carry
--     numeric ids only. erase_signer_pii (below) deletes the rows that belong to the erased person; the cores stay.
--   * corporate_approvals: who the agreement covers. kind 'user' and 'github_org' name a numeric GitHub id, 'email_domain' a
--     lower-case domain; source 'manager' is a decision of the CLA manager, source 'rule' is a user approval derived from an
--     email_domain or github_org approval when an employee claims coverage (E21-S04) and expires. Like the signature
--     it is revoked once and never changes again (trigger); a revocation is prospective. revoke_reason is free text of at most
--     500 characters that is NOT erasable (a revoked row cannot be edited): it must never hold personal data, and the route
--     that writes it (E21-S03) says so and validates it.
--   * repositories.corporate_document_id: the corporate CLA document of a repository (E21-S02 sets it). NULL means the
--     repository accepts individual signatures only.
--
-- Tenancy: every table carries the installation through a composite foreign key to its parent, so a row can never point at
-- another tenant's agreement, document or approval. corporate_approvals_active_idx is the partial index of the evaluation
-- query of E21-S05 (covered ids per installation); it is created here because this epic has two migration numbers and
-- E21-S04 needs the second.
--
-- Nothing of migration 001 is weakened: no trigger, constraint or grant is dropped or relaxed. The runtime role gets INSERT and
-- SELECT on the four new tables, UPDATE on the three revocation columns of corporate_approvals and nothing else.

select set_config('search_path', quote_ident(current_schema()) || ', pg_catalog, pg_temp', true);

-- ------------------------------------------------------------------------------------------- the agreement

create table corporate_agreements (
  id               bigint generated always as identity primary key,
  installation_id  bigint not null,
  signature_id     bigint not null unique references signatures (id) on delete restrict,
  document_id      bigint not null,
  major            integer not null check (major >= 1),
  created_at       timestamptz not null default now(),
  unique (id, installation_id),
  foreign key (document_id, installation_id) references cla_documents (id, installation_id) on delete restrict
);
create index corporate_agreements_installation_id_idx on corporate_agreements (installation_id, id);
create index corporate_agreements_document_major_idx on corporate_agreements (document_id, major);

-- The agreement repeats three facts of its signature and must agree with them. A signature that does not exist is left to the
-- foreign key (this trigger runs first and has nothing to compare). Pinned search_path, as for every function here.
create function corporate_agreements_guard_insert() returns trigger
language plpgsql
set search_path from current
as $$
declare
  v_signature record;
begin
  select signer_type, installation_id, document_id, major
    into v_signature from signatures where id = new.signature_id;
  if not found then
    return new;
  end if;
  if v_signature.signer_type <> 'corporate' then
    raise exception 'corporate_agreements: the signature is not a corporate one'
      using errcode = 'check_violation',
            hint = 'The consent of the signatory is a signatures row with signer_type corporate.';
  end if;
  if v_signature.installation_id <> new.installation_id then
    raise exception 'corporate_agreements: the installation differs from the installation of the signature'
      using errcode = 'check_violation';
  end if;
  if v_signature.document_id <> new.document_id then
    raise exception 'corporate_agreements: the document differs from the document of the signature'
      using errcode = 'check_violation';
  end if;
  if v_signature.major <> new.major then
    raise exception 'corporate_agreements: the major differs from the major of the signature'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger corporate_agreements_guard_insert before insert on corporate_agreements
  for each row execute function corporate_agreements_guard_insert();
create trigger corporate_agreements_immutable before update or delete on corporate_agreements
  for each row execute function forbid_modification();
create trigger corporate_agreements_no_truncate before truncate on corporate_agreements
  for each statement execute function forbid_modification();

-- Erasable text of the agreement: the company the signatory signed for and their title. The limits are the characters
-- of the route (E21-S02), counted as code points here, which never refuses what the route accepts.
create table corporate_agreement_pii (
  agreement_id     bigint primary key references corporate_agreements (id) on delete restrict,
  company_name     text not null check (char_length(company_name) <= 200 and btrim(company_name) <> ''),
  signatory_title  text not null check (char_length(signatory_title) <= 100 and btrim(signatory_title) <> '')
);

-- Personal data cannot come back after an erasure, as for signer_pii: the text of an agreement whose signatory was erased at or
-- after signing is refused (a signing request that was in flight while the person was erased). The erasure of one tenant does
-- not stop a signing at another; an audit row without an installation counts everywhere.
create function corporate_agreement_pii_guard_insert() returns trigger
language plpgsql
set search_path from current
as $$
begin
  if exists (
    select 1
    from corporate_agreements as g
    join signatures as s on s.id = g.signature_id
    join users as u on u.id = s.user_id
    join audit_log as a on a.action = 'signer_pii.erased' and a.subject_type = 'user' and a.subject_id = u.github_id
                       and (a.installation_id = s.installation_id or a.installation_id is null)
    where g.id = new.agreement_id and a.occurred_at >= s.signed_at
  ) then
    raise exception 'corporate_agreement_pii: the signatory of this agreement was erased; their personal data is not stored again'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger corporate_agreement_pii_guard_insert before insert on corporate_agreement_pii
  for each row execute function corporate_agreement_pii_guard_insert();

-- ------------------------------------------------------------------------------------------- the approvals

create table corporate_approvals (
  id                        bigint generated always as identity primary key,
  installation_id           bigint not null,
  agreement_id              bigint not null,
  kind                      text not null
    constraint corporate_approvals_kind_check check (kind in ('user', 'email_domain', 'github_org')),
  subject_github_id         bigint
    constraint corporate_approvals_subject_github_id_check check (subject_github_id > 0),
  -- A dotted hostname in lower case: labels of letters, digits and inner hyphens (an internationalised name is its punycode
  -- form, xn--...), at least two labels, the last one starting with a letter (so an IP address is no domain), 253 characters
  -- at most. The matching is by exact equality; there are no implicit subdomains.
  subject_domain            text
    constraint corporate_approvals_subject_domain_check check (
      char_length(subject_domain) <= 253
      and subject_domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$'
    ),
  source                    text not null
    constraint corporate_approvals_source_check check (source in ('manager', 'rule')),
  approved_by               bigint references users (id) on delete restrict,
  derived_from_approval_id  bigint,
  approved_at               timestamptz not null default now(),
  expires_at                timestamptz,
  revoked_at                timestamptz,
  revoked_by                bigint references users (id) on delete restrict,
  revoke_reason             text
    constraint corporate_approvals_revoke_reason_check check (char_length(revoke_reason) <= 500),
  unique (id, agreement_id, installation_id),
  constraint corporate_approvals_subject_check check (
    case when kind = 'email_domain' then subject_domain is not null and subject_github_id is null
         else subject_github_id is not null and subject_domain is null end
  ),
  constraint corporate_approvals_rule_user_check check (source <> 'rule' or kind = 'user'),
  constraint corporate_approvals_approved_by_check check ((source = 'manager') = (approved_by is not null)),
  constraint corporate_approvals_derived_from_check check ((source = 'rule') = (derived_from_approval_id is not null)),
  constraint corporate_approvals_expires_at_check check ((source = 'rule') = (expires_at is not null)),
  constraint corporate_approvals_expiry_order_check check (expires_at is null or expires_at > approved_at),
  constraint corporate_approvals_revocation_pair_check check ((revoked_at is null) = (revoked_by is null)),
  constraint corporate_approvals_revoke_reason_needs_revocation_check check (revoke_reason is null or revoked_at is not null),
  constraint corporate_approvals_revocation_order_check check (revoked_at is null or revoked_at >= approved_at),
  foreign key (agreement_id, installation_id) references corporate_agreements (id, installation_id) on delete restrict,
  foreign key (derived_from_approval_id, agreement_id, installation_id)
    references corporate_approvals (id, agreement_id, installation_id) on delete restrict
);

-- One active approval per agreement, kind and subject: the subject is the numeric id or the domain, and the one that does not
-- apply to the kind is NULL, which NULLS NOT DISTINCT compares as equal.
create unique index corporate_approvals_active_unique
  on corporate_approvals (agreement_id, kind, subject_github_id, subject_domain) nulls not distinct
  where revoked_at is null;
-- The covered-ids query of the evaluation (E21-S05).
create index corporate_approvals_active_idx on corporate_approvals (installation_id, agreement_id, kind)
  where revoked_at is null;

-- A derived approval derives from an email_domain or github_org approval that is still active. The same-agreement and
-- same-tenant rule is the composite foreign key. FOR SHARE makes a concurrent revocation of that approval and this insert wait
-- for each other: the revocation then sees the derived row (and revokes it), or this insert sees the revocation (and fails).
create function corporate_approvals_guard_insert() returns trigger
language plpgsql
set search_path from current
as $$
declare
  v_parent record;
begin
  if new.source = 'rule' then
    select kind, revoked_at into v_parent from corporate_approvals where id = new.derived_from_approval_id for share;
    if found and v_parent.kind not in ('email_domain', 'github_org') then
      raise exception 'corporate_approvals: a derived approval derives from an email_domain or github_org approval'
        using errcode = 'check_violation';
    end if;
    if found and v_parent.revoked_at is not null then
      raise exception 'corporate_approvals: a derived approval cannot derive from a revoked approval'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger corporate_approvals_guard_insert before insert on corporate_approvals
  for each row execute function corporate_approvals_guard_insert();

-- The only possible UPDATE revokes an approval that is not revoked yet (the rule of signatures_guard_update, migration 001). The
-- row is compared as a whole, so a column added later is immutable by default.
create function corporate_approvals_guard_update() returns trigger
language plpgsql
set search_path from current
as $$
begin
  if to_jsonb(new) - 'revoked_at' - 'revoked_by' - 'revoke_reason'
     is distinct from to_jsonb(old) - 'revoked_at' - 'revoked_by' - 'revoke_reason' then
    raise exception 'corporate_approvals is immutable: only revoked_at, revoked_by and revoke_reason may be set'
      using errcode = 'restrict_violation';
  end if;
  if old.revoked_at is not null then
    raise exception 'corporate_approvals is immutable: a revoked approval cannot be changed or un-revoked'
      using errcode = 'restrict_violation';
  end if;
  if new.revoked_at is null then
    raise exception 'corporate_approvals is immutable: UPDATE is only allowed to revoke'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger corporate_approvals_guard_update before update on corporate_approvals
  for each row execute function corporate_approvals_guard_update();
create trigger corporate_approvals_no_delete before delete on corporate_approvals
  for each row execute function forbid_modification();
create trigger corporate_approvals_no_truncate before truncate on corporate_approvals
  for each statement execute function forbid_modification();

-- Erasable login snapshot of an approved user or org (display only, never matched on).
create table corporate_approval_pii (
  approval_id  bigint primary key references corporate_approvals (id) on delete restrict,
  login        text not null check (char_length(login) <= 255 and btrim(login) <> '')
);

-- As corporate_agreement_pii_guard_insert, for the person an approval of kind user names: a login snapshot of a person erased at
-- or after the approval was made is refused. An approval made after the erasure is a new decision and may have its own row.
-- An org is no person: the check is for kind user only.
create function corporate_approval_pii_guard_insert() returns trigger
language plpgsql
set search_path from current
as $$
begin
  if exists (
    select 1
    from corporate_approvals as p
    join audit_log as a on a.action = 'signer_pii.erased' and a.subject_type = 'user' and a.subject_id = p.subject_github_id
                       and (a.installation_id = p.installation_id or a.installation_id is null)
    where p.id = new.approval_id and p.kind = 'user' and a.occurred_at >= p.approved_at
  ) then
    raise exception 'corporate_approval_pii: the person of this approval was erased; their login is not stored again'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger corporate_approval_pii_guard_insert before insert on corporate_approval_pii
  for each row execute function corporate_approval_pii_guard_insert();

-- ------------------------------------------------------------------------------------------- the repository

alter table repositories add column corporate_document_id bigint;
alter table repositories
  add constraint repositories_corporate_document_fk
  foreign key (corporate_document_id, installation_id) references cla_documents (id, installation_id) on delete restrict;

-- The document must be a corporate one. The tenant is the foreign key's business (a missing document or one of another tenant
-- fails there), so this trigger looks at the kind only, and a document that is not found is left to the foreign key.
create function repositories_guard_corporate_document() returns trigger
language plpgsql
set search_path from current
as $$
declare
  v_kind text;
begin
  if new.corporate_document_id is null then
    return new;
  end if;
  select kind into v_kind from cla_documents where id = new.corporate_document_id;
  if found and v_kind <> 'corporate' then
    raise exception 'repositories.corporate_document_id must point at a document of kind corporate'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger repositories_guard_corporate_document before insert or update of corporate_document_id on repositories
  for each row execute function repositories_guard_corporate_document();

-- ---------------------------------------------------------------------------------------------- erasure

-- erase_signer_pii (migration 013) also deletes, in the installation it is given:
--   * the corporate_agreement_pii rows of the agreements whose signature belongs to the erased person (the signatory), and
--   * the corporate_approval_pii rows of the approvals of kind user whose subject is the erased person (an employee, a
--     signatory's own approval included).
-- The cores (agreements, approvals, signatures) stay, as the signature core always did. A person who never signed in and is
-- known to the installation only as the subject of an approval is erased too (as an allowlisted account is since 013): not an
-- error. The audit row carries { signer_pii_rows } and nothing else, the function returns the number of deleted signer_pii
-- rows, and everything else is as before. Same name and arguments (CREATE OR REPLACE), so no overload appears and the grants
-- and the revoke from public stay as they are.
create or replace function erase_signer_pii(p_github_id bigint, p_actor_github_id bigint, p_installation_id bigint) returns integer
language plpgsql
security definer
set search_path from current
as $$
declare
  v_user_id bigint;
  v_deleted integer;
begin
  if p_actor_github_id is null or p_actor_github_id <= 0 then
    raise exception 'erase_signer_pii: the acting administrator is required' using errcode = 'invalid_parameter_value';
  end if;
  if p_installation_id is null then
    raise exception 'erase_signer_pii: the installation is required' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from installations where id = p_installation_id) then
    raise exception 'erase_signer_pii: no installation with that id' using errcode = 'no_data_found';
  end if;
  select id into v_user_id from users where github_id = p_github_id for update;
  if not found
     and not exists (
       select 1 from allowlist_entries where installation_id = p_installation_id and github_id = p_github_id
     )
     and not exists (
       select 1 from corporate_approvals
        where installation_id = p_installation_id and kind = 'user' and subject_github_id = p_github_id
     ) then
    raise exception 'erase_signer_pii: no user with that GitHub id' using errcode = 'no_data_found';
  end if;

  -- Without a users row v_user_id is null, which matches no signature: the deletes of signer_pii and corporate_agreement_pii
  -- change nothing, the scrub of the user and the sessions is skipped, and the person is only listed or approved.
  delete from signer_pii as p
   using signatures as s
   where s.id = p.signature_id and s.installation_id = p_installation_id and p.user_id = v_user_id;
  get diagnostics v_deleted = row_count;

  delete from corporate_agreement_pii as p
   using corporate_agreements as g, signatures as s
   where g.id = p.agreement_id and s.id = g.signature_id
     and g.installation_id = p_installation_id and s.user_id = v_user_id;

  delete from corporate_approval_pii as p
   using corporate_approvals as a
   where a.id = p.approval_id
     and a.installation_id = p_installation_id and a.kind = 'user' and a.subject_github_id = p_github_id;

  update allowlist_entries set login_snapshot = null
   where installation_id = p_installation_id and github_id = p_github_id and login_snapshot is not null;

  if v_user_id is not null and not exists (select 1 from signer_pii where user_id = v_user_id) then
    delete from sessions where user_id = v_user_id;
    update users
       set login = 'erased-' || github_id::text, name = null, avatar_url = null, updated_at = now()
     where id = v_user_id;
  end if;

  insert into audit_log (installation_id, actor_github_id, action, subject_type, subject_id, metadata)
  values (p_installation_id, p_actor_github_id, 'signer_pii.erased', 'user', p_github_id,
          jsonb_build_object('signer_pii_rows', v_deleted));

  return v_deleted;
end;
$$;

-- ---------------------------------------------------------------------------------------------- runtime role

-- Grants are made only when the role exists (a plain install or PGlite has none), as in migration 001. The table-level UPDATE
-- of repositories (migration 001) already covers the new column. Deliberately absent, here as for the signature core: DELETE
-- and TRUNCATE anywhere, UPDATE on corporate_agreements, on the two pii tables and on every column of corporate_approvals but
-- the three of the revocation. The revoke restates that in the migration itself.
do $$
declare
  s text := quote_ident(current_schema());
begin
  if not exists (select 1 from pg_roles where rolname = 'cla_app') then
    raise notice 'role cla_app does not exist: runtime grants skipped';
    return;
  end if;
  execute format('grant select, insert on %1$s.corporate_agreements, %1$s.corporate_agreement_pii, %1$s.corporate_approvals, %1$s.corporate_approval_pii to cla_app', s);
  execute format('grant update (revoked_at, revoked_by, revoke_reason) on %1$s.corporate_approvals to cla_app', s);
  execute format('revoke delete, truncate on %1$s.corporate_agreements, %1$s.corporate_agreement_pii, %1$s.corporate_approvals, %1$s.corporate_approval_pii from cla_app', s);
end;
$$;
