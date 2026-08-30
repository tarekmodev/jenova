-- 0002_tenant_runtime_grants — least-privilege runtime role (PR #42 review H1).
--
-- The ledger/audit guarantees in 0001 (append-only triggers, deferred balance
-- check) only bind a role that is neither superuser nor the table owner: an
-- owner can DISABLE TRIGGER / DROP TRIGGER, and a superuser can bypass
-- triggers with session_replication_role. So the request path must never run
-- as the schema owner.
--
-- This migration provisions (idempotently, per database it fans out to) a
-- shared NOLOGIN group role `jenova_runtime`: NOSUPERUSER, NOCREATEDB,
-- NOCREATEROLE, owner of nothing, no DDL. It gets plain CRUD on ordinary
-- tables but ONLY SELECT + INSERT on journal_entry and audit_event — the
-- append-only invariant holds at the privilege level even before the
-- triggers fire. Login credentials are wired by ops (staging task #34) as a
-- LOGIN member of this group; the resolver connects through
-- JENOVA_TENANT_RUNTIME_DSN and never reuses owner/migration credentials.
--
-- Owner/superuser access to tenant databases is a break-glass, audited
-- operational path — never the application path.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'jenova_runtime') then
    create role jenova_runtime nologin nosuperuser nocreatedb nocreaterole;
  end if;
exception
  when duplicate_object then null; -- concurrent migrator created it first
end;
$$;

-- Only the owner and the runtime role may connect to a tenant database.
do $$
begin
  execute format('revoke connect, temporary on database %I from public', current_database());
  execute format('grant connect on database %I to jenova_runtime', current_database());
end;
$$;

grant usage on schema public to jenova_runtime;

-- CRUD on ordinary tables...
grant select, insert, update, delete on all tables in schema public to jenova_runtime;

-- ...but the ledger and audit trail are append-only for the app path at the
-- privilege level too: SELECT + INSERT only.
revoke update, delete on journal_entry from jenova_runtime;
revoke update, delete on audit_event from jenova_runtime;

-- Migration state belongs to the migrator, not the app.
revoke all on _jenova_migrations from jenova_runtime;
grant select on _jenova_migrations to jenova_runtime;

grant usage, select on all sequences in schema public to jenova_runtime;

-- Tables added by future (owner-run) expand migrations default to runtime
-- CRUD; any future append-only table must revoke update/delete on itself in
-- its own migration, exactly as above.
alter default privileges in schema public grant select, insert, update, delete on tables to jenova_runtime;
alter default privileges in schema public grant usage, select on sequences to jenova_runtime;
