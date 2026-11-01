-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 Giovanni Manzoni
--
-- Runs once, when the development database volume is created (docker-compose.yml mounts it into
-- /docker-entrypoint-initdb.d). It creates the unprivileged runtime role; migration 001 grants it its privileges on the
-- tables. The password is a well-known development default, not a secret.
create role cla_app login password 'cla_app_dev_only' nosuperuser nocreatedb nocreaterole noinherit;
grant connect on database cla to cla_app;
