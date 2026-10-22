-- =========================================================
-- UCC 2.0 — Phase 1D: duplicate-USN signup guard
-- Date: 2026-10-22
--
-- Forward-only. Replaces public.handle_new_user() so a duplicate normalized
-- USN aborts the auth.users INSERT instead of leaving an auth account with
-- no profile row.
--
-- Why this migration exists
-- -------------------------
-- 2026102201_member_identity_and_contacts.sql caught unique_violation and
-- tried to compare the failing key with the submitted USN using a regular
-- expression. PostgreSQL's actual detail text is:
--
--   Key (upper(btrim(usn)))=(VALUE) already exists.
--
-- There is no whitespace after '=', and the value is wrapped in parentheses,
-- so that expression cannot match. The handler therefore re-raised by
-- accident. That happens to avoid orphaned auth users, but it is fragile and
-- misleading: "fixing" the regular expression later would silently create an
-- auth user whose profile INSERT was swallowed.
--
-- This migration makes the intended behaviour explicit and independent of
-- error-detail formatting:
--   - duplicate USN  -> raise SQLSTATE 23505 and roll back the signup
--   - any other key  -> raise unchanged
--
-- No account is merged, deleted, or reassigned. The profile primary key is
-- already handled by ON CONFLICT (id), so a unique_violation here is a USN
-- key (the legacy raw key and/or the global normalized index).
-- =========================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  yr int;
  grad_yr int;
  usn_val text;
  intent text;
  member_kind text;
begin
  begin
    yr := nullif(meta->>'year', '')::int;
  exception when others then
    yr := null;
  end;
  if yr is not null and (yr < 1 or yr > 4) then
    yr := null;
  end if;

  begin
    grad_yr := nullif(meta->>'graduation_year', '')::int;
  exception when others then
    grad_yr := null;
  end;
  if grad_yr is not null and (grad_yr < 1950 or grad_yr > 2200) then
    grad_yr := null;
  end if;

  usn_val := nullif(upper(btrim(meta->>'usn')), '');
  intent := lower(coalesce(meta->>'intent', 'student'));
  member_kind := case when intent = 'alumni' then 'alumni' else 'student' end;

  insert into public.profiles (
    id, email, name, usn, year, branch, section, bio,
    skills, interests, role, faculty_status,
    designation, employee_id, expertise,
    member_type, graduation_year
  ) values (
    new.id,
    new.email,
    coalesce(nullif(meta->>'name', ''), split_part(new.email, '@', 1), 'Member'),
    usn_val,
    yr,
    coalesce(nullif(meta->>'department', ''), 'CSE'),
    nullif(meta->>'section', ''),
    nullif(meta->>'bio', ''),
    case when jsonb_typeof(meta->'skills') = 'array'
      then array(select jsonb_array_elements_text(meta->'skills'))
      else '{}'::text[]
    end,
    case when jsonb_typeof(meta->'interests') = 'array'
      then array(select jsonb_array_elements_text(meta->'interests'))
      else '{}'::text[]
    end,
    'student',
    case when intent = 'faculty' then 'pending' else 'none' end,
    case when intent = 'faculty' then nullif(meta->>'designation', '') else null end,
    case when intent = 'faculty' then nullif(meta->>'employee_id', '') else null end,
    '{}'::text[],
    member_kind,
    grad_yr
  )
  on conflict (id) do update set
    email = coalesce(excluded.email, public.profiles.email),
    name = coalesce(
      nullif(public.profiles.name, ''),
      excluded.name
    );

  return new;
exception when unique_violation then
  -- Abort the surrounding auth.users INSERT. This is deliberate: the user
  -- must not end up authenticated with no profile. The full USN is not
  -- echoed. The diagnostic is documented in docs/ucc2-phase1-runbook.md.
  raise exception using
    errcode = '23505',
    message = 'USN is already registered to another account.',
    detail = 'Signup was rolled back; no auth user or profile was created.',
    hint = 'Sign in with the existing account or ask an administrator to review the USN collision.';
end;
$$;

comment on function public.handle_new_user() is
  'Provisions a profile on auth signup. Duplicate normalized USN aborts the signup so no auth user is created without a profile.';

-- -------------------------------------------------------------------------
-- End of Phase 1D. Reload PostgREST so the function body change is visible
-- where applicable (function bodies are not typically cached, but this keeps
-- the migration convention consistent).
-- -------------------------------------------------------------------------
notify pgrst, 'reload schema';
