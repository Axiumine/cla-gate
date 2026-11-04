-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 Giovanni Manzoni
--
-- E19-S03: the database and its roles, for every environment. scripts/provision-database.sh runs this file with psql 15
-- or later (it needs \getenv); read that script's header first. Idempotent: it creates what is missing, corrects what
-- drifted, prints one line per step and never drops anything.
--
-- Inputs reach this file only through the environment of the psql process (\getenv): the names, and the three
-- passwords. A password is never a -v assignment (argv), a file or a command line. Every identifier is built with
-- format('%I') and every password with format('%L').
--
-- Output lines are `<step>: created|updated|unchanged` and `role <name> password: set`. A refusal prints one line
-- `provision-database: invalid: ...` (the input cannot be used) or `provision-database: conflict: ...` (the server
-- holds something this file will not change) on stderr and then fails, so that nothing after it runs; the shell
-- script turns the two prefixes into the exit codes 2 and 3.

\set ON_ERROR_STOP on
\set VERBOSITY terse
set client_min_messages = warning;

\set db cla
\set owner cla_owner
\set app cla_app
\set test_role ''
\set owner_password ''
\set app_password ''
\set test_password ''
\set node_env ''
\getenv db CLA_DB_NAME
\getenv owner CLA_OWNER_ROLE
\getenv test_role CLA_TEST_ROLE
\getenv owner_password CLA_OWNER_PASSWORD
\getenv app_password CLA_APP_PASSWORD
\getenv test_password CLA_TEST_PASSWORD
\getenv node_env NODE_ENV

-- ------------------------------------------------------------------------------------------------ input checks
-- Everything that can be known from the inputs and the cluster is checked before the first change.

select
  :'db' ~ '^[a-z_][a-z0-9_]{0,62}$' as db_ok,
  :'owner' ~ '^[a-z_][a-z0-9_]{0,62}$' and :'owner' !~ '^pg_' and :'owner' <> :'app' as owner_ok,
  (:'test_role' = '' or (
    :'test_role' ~ '^[a-z_][a-z0-9_]{0,62}$' and :'test_role' !~ '^pg_' and :'test_role' not in (:'owner', :'app')
  )) as test_ok,
  (:'owner_password' = '' or char_length(:'owner_password') >= 16) as owner_password_ok,
  (:'app_password' = '' or char_length(:'app_password') >= 16) as app_password_ok,
  (:'test_password' = '' or char_length(:'test_password') >= 16) as test_password_ok,
  :'test_role' = '' or :'node_env' <> 'production' as test_allowed,
  (:'test_password' = '' or :'test_role' <> '') as test_password_used
\gset

\if :db_ok
\else
  \warn provision-database: invalid: CLA_DB_NAME must match ^[a-z_][a-z0-9_]{0,62}$
  do $$ begin raise exception 'provisioning refused, nothing was changed'; end $$;
\endif
\if :owner_ok
\else
  \warn provision-database: invalid: CLA_OWNER_ROLE must match ^[a-z_][a-z0-9_]{0,62}$, must not start with pg_ and must not be cla_app
  do $$ begin raise exception 'provisioning refused, nothing was changed'; end $$;
\endif
\if :test_ok
\else
  \warn provision-database: invalid: CLA_TEST_ROLE must match ^[a-z_][a-z0-9_]{0,62}$, must not start with pg_ and must differ from the two application roles
  do $$ begin raise exception 'provisioning refused, nothing was changed'; end $$;
\endif
\if :owner_password_ok
\else
  \warn provision-database: invalid: CLA_OWNER_PASSWORD is shorter than 16 characters
  do $$ begin raise exception 'provisioning refused, nothing was changed'; end $$;
\endif
\if :app_password_ok
\else
  \warn provision-database: invalid: CLA_APP_PASSWORD is shorter than 16 characters
  do $$ begin raise exception 'provisioning refused, nothing was changed'; end $$;
\endif
\if :test_password_ok
\else
  \warn provision-database: invalid: CLA_TEST_PASSWORD is shorter than 16 characters
  do $$ begin raise exception 'provisioning refused, nothing was changed'; end $$;
\endif
\if :test_allowed
\else
  \warn provision-database: invalid: CLA_TEST_ROLE is a development-only role and is refused when NODE_ENV=production
  do $$ begin raise exception 'provisioning refused, nothing was changed'; end $$;
\endif
\if :test_password_used
\else
  \warn provision-database: invalid: CLA_TEST_PASSWORD needs CLA_TEST_ROLE
  do $$ begin raise exception 'provisioning refused, nothing was changed'; end $$;
\endif

-- The state of the cluster. An absent role or database gives empty names and false flags.
select
  exists (select 1 from pg_roles where rolname = :'owner') as owner_exists,
  exists (select 1 from pg_roles where rolname = :'app') as app_exists,
  :'test_role' <> '' and exists (select 1 from pg_roles where rolname = :'test_role') as test_exists,
  exists (select 1 from pg_database where datname = :'db') as db_exists,
  coalesce((select pg_get_userbyid(datdba) from pg_database where datname = :'db'), '') as db_owner,
  coalesce((select pg_encoding_to_char(encoding) from pg_database where datname = :'db'), '') as db_encoding,
  current_user::text as admin_user,
  exists (select 1 from pg_roles where oid = 10 and rolname in (:'owner', :'app', :'test_role')) as bootstrap_named
\gset

select
  not :'owner_exists'::boolean and :'owner_password' = '' as owner_needs_password,
  not :'app_exists'::boolean and :'app_password' = '' as app_needs_password,
  :'test_role' <> '' and not :'test_exists'::boolean and :'test_password' = '' as test_needs_password
\gset

\if :owner_needs_password
  \warn provision-database: invalid: role :owner does not exist and no password was given: set CLA_OWNER_PASSWORD or CLA_OWNER_PASSWORD_FILE, or run on a terminal
  do $$ begin raise exception 'provisioning refused, nothing was changed'; end $$;
\endif
\if :app_needs_password
  \warn provision-database: invalid: role :app does not exist and no password was given: set CLA_APP_PASSWORD or CLA_APP_PASSWORD_FILE, or run on a terminal
  do $$ begin raise exception 'provisioning refused, nothing was changed'; end $$;
\endif
\if :test_needs_password
  \warn provision-database: invalid: role :test_role does not exist and no password was given: set CLA_TEST_PASSWORD or CLA_TEST_PASSWORD_FILE, or run on a terminal
  do $$ begin raise exception 'provisioning refused, nothing was changed'; end $$;
\endif

-- Refusals about what the server already holds.
select
  :'admin_user' in (:'owner', :'app', :'test_role') as admin_is_role,
  :'db_exists'::boolean and :'db_owner' <> :'owner' as owner_conflict,
  :'db_exists'::boolean and :'db_encoding' <> 'UTF8' as encoding_conflict
\gset

\if :bootstrap_named
  \warn provision-database: conflict: refusing to change the attributes of the bootstrap superuser of this server
  do $$ begin raise exception 'provisioning refused, nothing was changed'; end $$;
\endif
\if :admin_is_role
  \warn provision-database: conflict: refusing to change a role that this connection logs in as: connect with an administrator account (PGUSER)
  do $$ begin raise exception 'provisioning refused, nothing was changed'; end $$;
\endif
\if :owner_conflict
  \warn provision-database: conflict: refusing to change the owner of an existing database
  do $$ begin raise exception 'provisioning refused, nothing was changed'; end $$;
\endif
\if :encoding_conflict
  \warn provision-database: conflict: the existing database does not use the UTF8 encoding, which cannot be changed
  do $$ begin raise exception 'provisioning refused, nothing was changed'; end $$;
\endif

-- ------------------------------------------------------------------------------------------------------ roles
-- Both application roles: LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS, corrected when they exist.

select
  exists (
    select 1 from pg_roles where rolname = :'owner'
      and not (rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls)
  ) as owner_drift,
  exists (
    select 1 from pg_roles where rolname = :'app'
      and not (rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls)
  ) as app_drift
\gset

\if :owner_exists
  \if :owner_drift
    select format('alter role %I login nosuperuser nocreatedb nocreaterole noreplication nobypassrls', :'owner') \gexec
    \echo role :owner: updated
  \else
    \echo role :owner: unchanged
  \endif
\else
  select format('create role %I login nosuperuser nocreatedb nocreaterole noreplication nobypassrls', :'owner') \gexec
  \echo role :owner: created
\endif
\if :app_exists
  \if :app_drift
    select format('alter role %I login nosuperuser nocreatedb nocreaterole noreplication nobypassrls', :'app') \gexec
    \echo role :app: updated
  \else
    \echo role :app: unchanged
  \endif
\else
  select format('create role %I login nosuperuser nocreatedb nocreaterole noreplication nobypassrls', :'app') \gexec
  \echo role :app: created
\endif

-- The optional development role: it creates the throw-away test databases (E19-S10), so it may create databases and roles.
select :'test_role' <> '' as test_wanted \gset
\if :test_wanted
  \if :test_exists
    select exists (
      select 1 from pg_roles where rolname = :'test_role'
        and not (rolcanlogin and not rolsuper and rolcreatedb and rolcreaterole and not rolreplication and not rolbypassrls)
    ) as test_drift
    \gset
    \if :test_drift
      select format('alter role %I login createdb createrole nosuperuser noreplication nobypassrls', :'test_role') \gexec
      \echo role :test_role: updated
    \else
      \echo role :test_role: unchanged
    \endif
  \else
    select format('create role %I login createdb createrole nosuperuser noreplication nobypassrls', :'test_role') \gexec
    \echo role :test_role: created
  \endif
\endif

-- Passwords are set on creation and again whenever one is supplied; a role whose password is not supplied keeps it.
select :'owner_password' <> '' as owner_password_given, :'app_password' <> '' as app_password_given,
  :'test_password' <> '' as test_password_given
\gset
\if :owner_password_given
  select format('alter role %I password %L', :'owner', :'owner_password') \gexec
  \echo role :owner password: set
\endif
\if :app_password_given
  select format('alter role %I password %L', :'app', :'app_password') \gexec
  \echo role :app password: set
\endif
\if :test_password_given
  select format('alter role %I password %L', :'test_role', :'test_password') \gexec
  \echo role :test_role password: set
\endif

-- Neither role is a member of the other, and the test role belongs to neither.
select count(*) > 0 as membership_drift
from pg_auth_members m
join pg_roles r on r.oid = m.roleid
join pg_roles u on u.oid = m.member
where r.rolname in (:'owner', :'app', :'test_role') and u.rolname in (:'owner', :'app', :'test_role')
\gset
\if :membership_drift
  select case when current_setting('server_version_num')::int >= 160000
      then format('revoke %I from %I granted by %I', r.rolname, u.rolname, pg_get_userbyid(m.grantor))
      else format('revoke %I from %I', r.rolname, u.rolname)
    end
  from pg_auth_members m
  join pg_roles r on r.oid = m.roleid
  join pg_roles u on u.oid = m.member
  where r.rolname in (:'owner', :'app', :'test_role') and u.rolname in (:'owner', :'app', :'test_role')
  \gexec
  \echo role membership: updated
\else
  \echo role membership: unchanged
\endif

-- -------------------------------------------------------------------------------------------------- database
\if :db_exists
  \echo database :db: unchanged
\else
  select format('create database %I owner %I encoding %L template template0', :'db', :'owner', 'UTF8') \gexec
  \echo database :db: created
\endif

-- PUBLIC holds no privilege on the database, cla_app only CONNECT, and the test role nothing. The owner needs no grant.
select exists (
    select 1 from pg_database d, aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a
    where d.datname = :'db' and (a.grantee = 0
      or (a.grantee = (select oid from pg_roles where rolname = :'app') and a.privilege_type <> 'CONNECT')
      or (:'test_role' <> '' and a.grantee = (select oid from pg_roles where rolname = :'test_role')))
  ) or not exists (
    select 1 from pg_database d, aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a
    where d.datname = :'db' and a.grantee = (select oid from pg_roles where rolname = :'app') and a.privilege_type = 'CONNECT'
  ) as database_drift
\gset
\if :database_drift
  select format('revoke all on database %I from public', :'db') \gexec
  select format('revoke all on database %I from %I', :'db', :'app') \gexec
  select format('grant connect on database %I to %I', :'db', :'app') \gexec
  select :'test_role' <> '' as test_revoke \gset
  \if :test_revoke
    select format('revoke all on database %I from %I', :'db', :'test_role') \gexec
  \endif
  \echo database :db access: updated
\else
  \echo database :db access: unchanged
\endif

-- ------------------------------------------------------------------------------------- inside the database
\connect :db

-- cla_app owns nothing (the migrations make cla_owner the owner of every table) and this file never reassigns or drops.
select count(*) > 0 as app_owns
from pg_shdepend
where refclassid = 'pg_authid'::regclass and deptype = 'o'
  and refobjid = (select oid from pg_roles where rolname = :'app')
  and dbid in (0, (select oid from pg_database where datname = current_database()))
\gset
\if :app_owns
  \warn provision-database: conflict: :app owns objects (or a database): refusing to continue, reassign them to :owner or drop them first
  do $$ begin raise exception 'provisioning refused, the earlier steps were applied'; end $$;
\endif

select
  exists (select 1 from pg_namespace where nspname = 'pgboss') as pgboss_exists,
  coalesce((select pg_get_userbyid(nspowner) from pg_namespace where nspname = 'pgboss'), '') as pgboss_owner
\gset
\if :pgboss_exists
  select :'pgboss_owner' <> :'owner' as pgboss_conflict \gset
  \if :pgboss_conflict
    \warn provision-database: conflict: refusing to change the owner of the existing schema pgboss
    do $$ begin raise exception 'provisioning refused, the earlier steps were applied'; end $$;
  \endif
\endif

-- PUBLIC has no CREATE on schema public (the default of PostgreSQL 15 and later, an explicit revoke before) and neither has cla_app.
select exists (
    select 1 from pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
    where n.nspname = 'public' and a.privilege_type = 'CREATE'
      and (a.grantee = 0 or a.grantee = (select oid from pg_roles where rolname = :'app'))
  ) as public_drift
\gset
\if :public_drift
  revoke create on schema public from public;
  select format('revoke create on schema public from %I', :'app') \gexec
  \echo schema public: updated
\else
  \echo schema public: unchanged
\endif

-- Schema pgboss: owned by the owner role, which installs the queue tables; cla_app may use them and cannot create in it.
\if :pgboss_exists
  \echo schema pgboss: unchanged
\else
  select format('create schema pgboss authorization %I', :'owner') \gexec
  \echo schema pgboss: created
\endif

-- Default privileges for what the owner creates in pgboss from now on, and nothing else. No ALTER DEFAULT PRIVILEGES
-- exists for the application tables: their minimal grants are the migrations' alone.
select
  has_schema_privilege(:'app', 'pgboss', 'USAGE') as app_usage,
  has_schema_privilege(:'app', 'pgboss', 'CREATE') as app_create,
  coalesce((
    select array_agg(a.privilege_type order by a.privilege_type)
    from pg_default_acl d, aclexplode(d.defaclacl) a
    where d.defaclrole = (select oid from pg_roles where rolname = :'owner')
      and d.defaclnamespace = 'pgboss'::regnamespace and d.defaclobjtype = 'r'
      and a.grantee = (select oid from pg_roles where rolname = :'app')
  ), '{}') = array['DELETE', 'INSERT', 'SELECT', 'UPDATE'] as tables_ok,
  coalesce((
    select array_agg(a.privilege_type order by a.privilege_type)
    from pg_default_acl d, aclexplode(d.defaclacl) a
    where d.defaclrole = (select oid from pg_roles where rolname = :'owner')
      and d.defaclnamespace = 'pgboss'::regnamespace and d.defaclobjtype = 'S'
      and a.grantee = (select oid from pg_roles where rolname = :'app')
  ), '{}') = array['SELECT', 'UPDATE', 'USAGE'] as sequences_ok,
  coalesce((
    select array_agg(a.privilege_type order by a.privilege_type)
    from pg_default_acl d, aclexplode(d.defaclacl) a
    where d.defaclrole = (select oid from pg_roles where rolname = :'owner')
      and d.defaclnamespace = 'pgboss'::regnamespace and d.defaclobjtype = 'f'
      and a.grantee = (select oid from pg_roles where rolname = :'app')
  ), '{}') = array['EXECUTE'] as functions_ok
\gset
select not :'app_usage'::boolean or :'app_create'::boolean or not :'tables_ok'::boolean or not :'sequences_ok'::boolean or not :'functions_ok'::boolean as pgboss_drift \gset
\if :pgboss_drift
  select format('grant usage on schema pgboss to %I', :'app') \gexec
  select format('revoke create on schema pgboss from %I', :'app') \gexec
  select format('alter default privileges for role %I in schema pgboss grant select, insert, update, delete on tables to %I',
    :'owner', :'app') \gexec
  select format('alter default privileges for role %I in schema pgboss grant usage, select, update on sequences to %I',
    :'owner', :'app') \gexec
  select format('alter default privileges for role %I in schema pgboss grant execute on functions to %I',
    :'owner', :'app') \gexec
  \echo schema pgboss access: updated
\else
  \echo schema pgboss access: unchanged
\endif
