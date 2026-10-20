-- =========================================================
-- 20261020 — Restore missing DELETE policies (discussion deletion bug)
--
-- Root cause (verified live on 2026-10-20): the hosted database was
-- provisioned from the pre-migration schema, which defines only the
-- select/insert/update policies for posts, events, and comments.
-- With RLS enabled and no DELETE policy, PostgREST silently filters every
-- DELETE to zero rows (HTTP 200 with [] and no error), so authors could
-- never delete their own discussions and the UI surfaced
-- "The discussion could not be deleted…".
--
-- This migration is idempotent and safe to re-run. It brings the DELETE
-- policies in line with supabase/schema.sql without touching any other
-- grant, and preserves the intended student/faculty/moderator/admin
-- permission model:
--   - authors delete their own posts/comments
--   - hosts delete their own events
--   - admins (profiles.role = 'admin') may delete all of the above,
--     checked server-side inside the policy via is_admin()
--
-- After applying, verify with:
--   select tablename, policyname, cmd, roles
--   from pg_policies
--   where schemaname = 'public'
--     and tablename in ('posts', 'events', 'comments');
-- Expected: one FOR DELETE policy per table (policy names below).
-- =========================================================

-- ---------------------------------------------------------
-- 1. is_admin() helper: databases provisioned from the original
--    schema.sql never defined this function, and the policies below
--    depend on it. create-or-replace is a no-op if it already exists
--    with the same body (canonical definition from supabase/schema.sql).
-- security definer so the policy's role lookup cannot be blocked by the
-- profiles RLS policy; it only compares public.profiles.id/role.
-- ---------------------------------------------------------
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = uid and p.role = 'admin'
  );
$$;

revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to authenticated, anon;

-- ---------------------------------------------------------
-- 2. Posts — authors and admins can delete.
--    drop-if-exists + create keeps this idempotent and repairs any
--    diverged/partial state of the same policy on the live database.
-- ---------------------------------------------------------
drop policy if exists "Authors can delete their posts" on public.posts;
create policy "Authors can delete their posts" on public.posts
  for delete using (auth.uid() = author_id or public.is_admin(auth.uid()));

-- ---------------------------------------------------------
-- 3. Events — hosts and admins can delete.
-- ---------------------------------------------------------
drop policy if exists "Hosts can delete their events" on public.events;
create policy "Hosts can delete their events" on public.events
  for delete using (auth.uid() = host_id or public.is_admin(auth.uid()));

-- ---------------------------------------------------------
-- 4. Comments — authors (and admins) can delete; cascade removes
--    child replies per the post_id/parent_id ON DELETE CASCADE rules.
-- ---------------------------------------------------------
drop policy if exists "Authors can delete comments" on public.comments;
create policy "Authors can delete comments" on public.comments
  for delete using (auth.uid() = author_id or public.is_admin(auth.uid()));

notify pgrst, 'reload schema';
