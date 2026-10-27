-- =========================================================
-- UCC 2.0 — persist alumni identity on signup
--
-- The hosted project's public.handle_new_user() predates the member identity
-- migration and ignores intent='alumni'. Replacing that function wholesale is
-- risky because production has drifted from the migration ledger and still
-- provisions the legacy user_profiles mirror.
--
-- This trigger is the minimal repair. It reads the signup metadata from the
-- auth row and sets only member_type/graduation_year before the profile row is
-- written. role, faculty_status and every other column stay the responsibility
-- of handle_new_user() and the faculty-approval flow, so student and faculty
-- verification are untouched.
--
-- The trigger is idempotent: on a database whose handle_new_user() already
-- writes the same values, it simply writes them again. It never infers alumni
-- from graduation_year — only an explicit intent='alumni' is honoured.
-- =========================================================

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'member_type'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'graduation_year'
  ) then
    raise exception using
      errcode = '42703',
      message = 'profiles.member_type/graduation_year are missing',
      hint = 'Apply 2026102201_member_identity_and_contacts.sql first.';
  end if;
end $$;

create or replace function public.set_alumni_identity_on_profile_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_metadata jsonb;
  v_intent text;
  v_graduation_year integer;
begin
  select u.raw_user_meta_data
    into v_metadata
  from auth.users as u
  where u.id = new.id;

  if v_metadata is null then
    return new;
  end if;

  v_intent := pg_catalog.lower(
    pg_catalog.btrim(coalesce(v_metadata ->> 'intent', ''))
  );

  -- Only an explicit alumni signup changes the identity. Students and
  -- faculty applicants keep whatever handle_new_user() provisioned.
  if v_intent <> 'alumni' then
    return new;
  end if;

  begin
    v_graduation_year := nullif(v_metadata ->> 'graduation_year', '')::integer;
  exception when others then
    v_graduation_year := null;
  end;

  if v_graduation_year is not null
     and (v_graduation_year < 1950 or v_graduation_year > 2200) then
    v_graduation_year := null;
  end if;

  new.member_type := 'alumni';
  new.graduation_year := v_graduation_year;

  return new;
end;
$function$;

comment on function public.set_alumni_identity_on_profile_insert() is
  'Persists member_type=alumni and graduation_year from auth signup metadata before a profile row is inserted.';

revoke all on function public.set_alumni_identity_on_profile_insert()
  from public, anon, authenticated;

drop trigger if exists profiles_set_alumni_identity_on_insert on public.profiles;
create trigger profiles_set_alumni_identity_on_insert
before insert on public.profiles
for each row execute procedure public.set_alumni_identity_on_profile_insert();
