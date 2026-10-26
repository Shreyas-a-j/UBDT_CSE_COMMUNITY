-- =========================================================
-- UCC 2.0 — backfill: updated_at trigger helper
-- Date: 2026-10-23
--
-- Repair for hand-managed deployments that are missing
-- public.update_updated_at_column() from 2026101302 while later tables and
-- migrations are present. The publish schema (2026102303) and the push
-- outbox (2026102401) both attach updated_at triggers that call it, so it
-- must exist before they run.
--
-- Additive and idempotent. No data is touched. The definition matches
-- supabase/schema.sql.
-- =========================================================

create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc'::text, now());
  return new;
end;
$$;
