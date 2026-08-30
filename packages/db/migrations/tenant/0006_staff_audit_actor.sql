-- 0006_staff_audit_actor — EXPAND-ONLY (widens one check constraint).
--
-- Tenant staff act from the Internal Dashboard from M2 on (settings
-- changes, manual-intervention actions) and their audit events carry
-- actor_type 'staff_user'. Widening the allowed set is expand-safe: code
-- N-1 never writes the new value and reads are unaffected.

alter table audit_event drop constraint audit_event_actor_type_check;
alter table audit_event add constraint audit_event_actor_type_check
  check (actor_type in ('platform_user', 'agency_user', 'staff_user', 'system', 'api_client'));
