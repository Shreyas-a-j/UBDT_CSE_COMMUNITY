-- =========================================================
-- UCC 2.0 — restore the announcements DELETE policy
-- Date: 2026-10-26
-- Migration: 2026102603_announcement_delete_policy.sql
--
-- Why this migration exists
-- -------------------------
-- 2026102001_delete_policies.sql restored DELETE policies for posts,
-- events and comments. It did not include announcements. On a hosted
-- database provisioned from the pre-migration schema, RLS is enabled on
-- public.announcements but there is no FOR DELETE policy.
--
-- PostgREST does not error when RLS filters a DELETE; it returns HTTP 200
-- with an empty array. The delete route used to interpret that as
-- "already gone", removed the row from local UI state, and left the
-- announcement in the database. This migration installs the canonical
-- policy that supabase/schema.sql already defines:
--
--   author OR administrator may delete
--
-- It is idempotent and changes no row, grant or policy other than this one.
-- The route is also hardened to distinguish a filtered delete from a row
-- that is genuinely absent.
--
-- Verify after applying:
--   select policyname, cmd, qual from pg_policies
--   where schemaname='public' and tablename='announcements' and cmd='DELETE';
-- =========================================================

begin;

do $$
begin
  if to_regclass('public.announcements') is null then
    raise exception 'public.announcements is missing';
  end if;
end $$;

alter table public.announcements enable row level security;

drop policy if exists "Authors delete announcements" on public.announcements;
create policy "Authors delete announcements"
  on public.announcements
  for delete
  using (
    auth.uid() = author_id
    or public.is_admin(auth.uid())
  );

-- Supabase normally grants this by default; make it explicit so the policy
-- is usable even on a database whose table grants were trimmed.
grant delete on public.announcements to authenticated;

comment on policy "Authors delete announcements" on public.announcements is
  'Author or administrator may hard-delete an announcement. Restored by 2026102603.';

notify pgrst, 'reload schema';

commit;
