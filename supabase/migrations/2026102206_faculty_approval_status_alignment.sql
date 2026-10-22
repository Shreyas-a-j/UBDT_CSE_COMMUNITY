-- =========================================================
-- Phase 6.1 — faculty approval vocabulary alignment
-- =========================================================
--
-- Why: the live UCC database stores approved faculty as
-- `profiles.faculty_status = 'approved'`, while the original migrations and
-- the announcement RLS helper only accepted 'verified'. The result was that
-- an approved faculty member was treated as unverified by the directory,
-- the publish UI, the publish API and the announcements INSERT policy.
--
-- 'approved' and 'verified' are the same approval state. This migration
-- accepts both (never downgrading existing rows) and makes 'approved' the
-- value written by new approvals.
--
-- Review before applying. It does not delete or rewrite any profile row.

begin;

-- 1. Allow both spellings. Existing values remain valid.
alter table public.profiles drop constraint if exists profiles_faculty_status_check;
alter table public.profiles add constraint profiles_faculty_status_check
  check (faculty_status in ('none', 'pending', 'approved', 'verified', 'rejected'));

-- 2. The announcements INSERT policy calls this helper. It must treat both
--    spellings as approved, while still rejecting students, alumni, pending
--    and rejected applicants.
create or replace function public.is_verified_faculty(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = uid
      and p.role in ('faculty', 'admin')
      and (p.role = 'admin' or p.faculty_status in ('approved', 'verified'))
  );
$$;

grant execute on function public.is_verified_faculty(uuid) to authenticated, anon;

-- 3. New approvals write the live database's canonical value. This is the
--    same trigger as before; only the written status changes.
create or replace function public.on_faculty_application_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    update public.profiles
    set
      role = case when role = 'admin' then 'admin' else 'faculty' end,
      faculty_status = 'approved',
      member_type = 'faculty',
      designation = new.designation,
      employee_id = new.employee_id,
      name = coalesce(nullif(name, ''), new.full_name),
      updated_at = timezone('utc'::text, now())
    where id = new.user_id;

    perform public.emit_notification(
      new.user_id,
      'faculty_decision',
      'Faculty access approved',
      'Your faculty application was approved. You now have faculty permissions.',
      '/faculty/dashboard'
    );
  elsif new.status = 'rejected' and old.status is distinct from 'rejected' then
    update public.profiles
    set faculty_status = 'rejected', updated_at = timezone('utc'::text, now())
    where id = new.user_id and role <> 'admin';

    perform public.emit_notification(
      new.user_id,
      'faculty_decision',
      'Faculty application update',
      coalesce(new.notes, 'Your faculty application was not approved.'),
      '/signup/faculty'
    );
  end if;
  return new;
end;
$$;

commit;
