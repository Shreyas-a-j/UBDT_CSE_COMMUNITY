-- =========================================================
-- UCC — make the demo fixture eligible for the bootstrap rehearsal
--
-- Disposable-database only. This simulates the legitimate faculty-approval
-- path having already promoted demo@gmail.com. It does not create an admin.
-- The bootstrap script still performs its own role/status verification.
-- =========================================================

do $eligible$
declare
  v_demo uuid;
begin
  select id into v_demo from public.profiles where email = 'demo@gmail.com';
  if v_demo is null then
    raise exception 'FAIL: demo fixture is missing';
  end if;

  alter table public.profiles disable trigger trg_protect_profile_privileges;
  update public.profiles
  set role = 'faculty',
      faculty_status = 'approved',
      member_type = 'faculty',
      designation = coalesce(designation, 'Professor')
  where id = v_demo;
  alter table public.profiles enable trigger trg_protect_profile_privileges;

  if exists (select 1 from public.profiles where role = 'admin') then
    raise exception 'FAIL: an administrator appeared before the bootstrap';
  end if;
end;
$eligible$;
