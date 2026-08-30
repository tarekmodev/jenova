-- 0005_agency_portal_auth — Agent Portal login + per-agency search defaults
-- (M2 issue #95; docs/apps/b2b.md "Agent Portal").
--
-- EXPAND-ONLY (CLAUDE.md rule 1): nullable columns on existing tables; code
-- N−1 never reads either. Fan-out safe: instant ALTERs, no data rewrites.

alter table agency_user
  -- argon2id PHC string (apps/api auth/password.ts). Nullable: staff create
  -- the user first, the credential is set on invite/reset; a NULL hash can
  -- never log in (login fails closed on it).
  add column password_hash text;

alter table agency
  -- Default guest nationality for this agency's searches (CLAUDE.md rule 9:
  -- nationality is a first-class, always-visible search parameter — this is
  -- the per-agency DEFAULT, the agent can always override per search).
  add column default_nationality char(2)
    check (default_nationality ~ '^[A-Z]{2}$');
