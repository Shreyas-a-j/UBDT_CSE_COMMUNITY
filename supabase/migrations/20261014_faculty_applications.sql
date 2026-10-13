-- =========================================================
-- UBDT CSE Community — Faculty Applications Persistence
-- Versioned migration (20261014). Idempotent. Additive only.
--
-- This migration creates or repairs the public.faculty_applications
-- table, its indexes, triggers, RLS policies, and helper functions.
-- Safe to run multiple times; safe to run on top of the earlier
-- 20261013 migrations.
--
-- Execution:
--   supabase db execute --file supabase/migrations/20261014_faculty_applications.sql
-- Or paste into Supabase Dashboard → SQL Editor → Run.
-- Then:  NOTIFY pgrst, 'reload schema';
-- =========================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- =========================================================
-- 1. Ensure auth.users exists (required for FK targets)
-- =========================================================
do $$
begin
  if not exists (
    select 1 from pg_namespace where nspname = 'auth'
  ) then
    raise exception 'Supabase auth schema not found. Apply this migration only on a fully initialised Supabase project.';
  end if;
end $$;

-- =========================================================
-- 2. Create / repair faculty_applications table
-- =========================================================
create table if not exists public.faculty_applications (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  full_name text not null,
  official_email text not null,
  department text not null default 'CSE',
  designation text not null,
  employee_id text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

-- Ensure updated_at column exists (backward compat with earlier migration)
alter table public.faculty_applications
  add column if not exists updated_at timestamptz;

-- =========================================================
-- 3. Indexes
-- =========================================================
-- Partial unique: at most one PENDING application per applicant.
-- This prevents duplicate submissions while still allowing
-- re-submission after rejection (the old row remains rejected).
create unique index if not exists faculty_applications_one_pending
  on public.faculty_applications (user_id)
  where status = 'pending';

-- Lookup indexes
create index if not exists faculty_applications_status_idx
  on public.faculty_applications (status);
create index if not exists faculty_applications_created_at_idx
  on public.faculty_applications (created_at desc);
create index if not exists faculty_applications_user_status_idx
  on public.faculty_applications (user_id, status);

-- =========================================================
-- 4. Updated-at trigger function + trigger
-- =========================================================
create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  if row(new.*) is distinct from row(old.*) then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_update_faculty_app_updated_at on public.faculty_applications;
create trigger trg_update_faculty_app_updated_at
  before update on public.faculty_applications
  for each row execute procedure public.update_updated_at_column();

-- =========================================================
-- 5. Transition enforcement trigger
-- Prevents users from inserting with non-pending status or
-- setting reviewer fields. Prevents non-admins from changing
-- status or reviewer metadata.
-- =========================================================
create or replace function public.enforce_faculty_application_transition()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status is distinct from 'pending' then
      raise exception 'Faculty applications must start as pending.';
    end if;
    if new.reviewed_by is not null or new.reviewed_at is not null then
      raise exception 'Cannot set reviewer on a new application.';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      if not exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'admin'
      ) then
        raise exception 'Only administrators can change application status.';
      end if;
      if old.status = 'approved' and new.status in ('pending', 'rejected') then
        raise exception 'An approved application cannot be reverted.';
      end if;
      if new.status in ('approved', 'rejected') and new.reviewed_at is null then
        new.reviewed_at := now();
      end if;
    end if;

    if new.reviewed_by is distinct from old.reviewed_by
       or new.reviewed_at is distinct from old.reviewed_at then
      if not exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'admin'
      ) then
        raise exception 'Only administrators can set reviewer fields.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_faculty_application_transition on public.faculty_applications;
create trigger trg_faculty_application_transition
  before insert or update on public.faculty_applications
  for each row execute procedure public.enforce_faculty_application_transition();

-- =========================================================
-- 6. Status-change trigger — keeps profiles in sync
-- Approved → promotes profile to faculty (preserves admin).
-- Rejected → marks faculty_status = rejected (preserves admin).
-- =========================================================
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
      faculty_status = 'verified',
      designation = new.designation,
      employee_id = new.employee_id,
      name = coalesce(nullif(name, ''), new.full_name),
      updated_at = now()
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
    set faculty_status = 'rejected', updated_at = now()
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

drop trigger if exists trg_faculty_application_status on public.faculty_applications;
create trigger trg_faculty_application_status
  after update on public.faculty_applications
  for each row execute procedure public.on_faculty_application_status();

-- =========================================================
-- 7. Helper: emit_notification (idempotent create-or-replace)
-- =========================================================
create or replace function public.emit_notification(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_body text default null,
  p_link text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then return; end if;
  insert into public.notifications (user_id, type, title, body, link)
  values (p_user_id, p_type, p_title, p_body, p_link);
end;
$$;

revoke all on function public.emit_notification(uuid, text, text, text, text) from public;
grant execute on function public.emit_notification(uuid, text, text, text, text) to authenticated;

-- =========================================================
-- 8. Row Level Security
-- =========================================================
alter table public.faculty_applications enable row level security;

drop policy if exists "Users read own faculty applications" on public.faculty_applications;
drop policy if exists "Users submit own faculty application" on public.faculty_applications;
drop policy if exists "Admins manage faculty applications" on public.faculty_applications;
drop policy if exists "Faculty view own application" on public.faculty_applications;

-- Applicants can view their own applications.
create policy "Users read own faculty applications" on public.faculty_applications
  for select
  using (auth.uid() = user_id
         or exists (
           select 1 from public.profiles p
           where p.id = auth.uid() and p.role = 'admin'
         ));

-- Applicants can insert a new pending application (enforced further by trigger).
create policy "Users submit own faculty application" on public.faculty_applications
  for insert
  with check (
    auth.uid() = user_id
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
  );

-- Admins can update any application (status changes, reviewer fields).
create policy "Admins manage faculty applications" on public.faculty_applications
  for update
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ));

-- =========================================================
-- 9. Schema cache reload
-- =========================================================
notify pgrst, 'reload schema';
