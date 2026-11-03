-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 Giovanni Manzoni
--
-- 011_cla_drafts (E12-S03): the work in progress on the text of a CLA. Forward-only: never edit this file once merged, add
-- a new migration instead.
--
-- A published version never changes (cla_versions, migration 001), so a maintainer's unfinished text lives in a table of its
-- own that is mutable on purpose: one draft per document, shared by every admin of the document's scope, saved only by an
-- explicit action. `revision` starts at 1 and the application raises it by one with each save in the statement that
-- compares it with the revision the editor read (optimistic concurrency): the database only keeps it positive. A draft is
-- not a signature, a version or an audit row, and nothing here weakens migration 001: no trigger, foreign key or grant of
-- any other table is dropped or relaxed, the immutability triggers of cla_versions and cla_documents are untouched, and the
-- draft never touches cla_documents.active_version_id.
--
-- Tenant tables carry the installation id and tie it to their parent with a composite foreign key (E04-S06): the pair
-- (document_id, installation_id) must exist in cla_documents, so a draft can never pair one tenant's document with another
-- tenant's installation. Deleting a document, or a user, that a draft points at is refused (on delete restrict); the
-- runtime role may delete the draft itself, which is what discarding it does.
--
-- The text is the maintainer's own wording, not signer data, so erasure does not touch the table. `updated_by` is `users.id`
-- (a key, not a name), and the row of a person who saved a draft cannot be deleted from under it.

create table cla_drafts (
  document_id      bigint primary key,
  installation_id  bigint not null,
  content_md       text not null,
  revision         integer not null default 1 check (revision >= 1),
  updated_by       bigint not null references users (id) on delete restrict,
  updated_at       timestamptz not null default now(),
  foreign key (document_id, installation_id) references cla_documents (id, installation_id) on delete restrict
);

-- The runtime role (cla_app) reads, creates, saves and discards drafts. It holds no privilege on the table until this block
-- runs, and the block does nothing when the role does not exist (a plain install or PGlite has none).
do $$
declare
  s text := quote_ident(current_schema());
begin
  if not exists (select 1 from pg_roles where rolname = 'cla_app') then
    raise notice 'role cla_app does not exist: runtime grants skipped';
    return;
  end if;
  execute format('grant select, insert, update, delete on %1$s.cla_drafts to cla_app', s);
end;
$$;
