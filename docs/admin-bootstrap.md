# Initial administrator bootstrap (one-time)

**Scope:** the first and only administrator for the UCC Supabase project.
**Status:** owner action; not a migration, not an API route, not a cron job.

This runbook exists because the app has no self-service way to become an
administrator. The first admin is created by the database owner exactly once,
from a verified approved-faculty account. Every later admin change goes through
the Phase 11 nomination/acceptance process.

## Files

| File | Purpose |
|---|---|
| `supabase/migrations/2026102208_single_admin_succession.sql` | single-admin index, admin check constraint, nomination/acceptance/resignation functions, audit log |
| `supabase/migrations/2026102209_admin_bootstrap.sql` | adds the `bootstrap` audit action and the permanent one-time marker |
| `supabase/migrations/2026102210_admin_role_check_alignment.sql` | widens `profiles_role_check` to permit `role = 'admin'` on databases that predate the canonical base migration |
| `supabase/admin/preflight-initial-admin.sql` | read-only eligibility check |
| `supabase/admin/bootstrap-initial-admin.sql` | the one-time owner operation |
| `supabase/test-admin-bootstrap.sql` | local rehearsal assertions for bootstrap + succession |

## Prerequisites

1. Migrations `2026102208`, `2026102209`, and `2026102210` are applied.
   `supabase db push` applies them; the bootstrap itself is deliberately
   **not** in `supabase/migrations/`, so a push can never promote anyone.
   Migration `2026102210` is required on databases whose older
   `profiles_role_check` still permits only student/faculty roles; the
   preflight reports `role_allows_admin = false` in that state.
2. The target account already exists in Supabase Auth and its linked
   `public.profiles` row is:
   - `role = 'faculty'`
   - `faculty_status = 'approved'`

   The account is `demo@gmail.com`. This email is only the locator for this one
   request. No policy, trigger, or application code grants admin by email.
3. No profile currently has `role = 'admin'`. If one does, stop: this is not an
   initial bootstrap, and the normal succession path applies.

## Step 1 — preflight (read-only)

Run `supabase/admin/preflight-initial-admin.sql` in the Supabase SQL Editor.

Read the single result row:

- `can_bootstrap = true` → continue.
- `can_bootstrap = false` → **stop and report**. Read `blocking_reasons`.
  Do not edit the email or promote another account automatically.

Useful columns: `auth_matches`, `profile_role`, `faculty_status`,
`approved_faculty`, `role_allows_admin`, `member_type_allows_faculty`,
`existing_admin_count`, `bootstrap_completed`.

## Step 2 — bootstrap once

Run `supabase/admin/bootstrap-initial-admin.sql` as the database owner in the
SQL Editor (or a direct owner `psql` connection).

It is one PL/pgSQL `DO` block, so it is atomic. It re-checks everything the
preflight checked, then in one transaction:

1. refuses if a JWT is present (`auth.uid() is not null`);
2. refuses if the permanent marker already exists;
3. resolves the account by `auth.users.id`, not by a client claim;
4. refuses unless `role = 'faculty'` **and**
   `faculty_status = 'approved'`;
5. refuses if any administrator already exists;
6. sets `role = 'admin'`, keeps `faculty_status = 'approved'`, and sets
   `member_type = 'faculty'`;
7. inserts the `bootstrap` row into `admin_audit_log` with the operator,
   target, verified role/status, and timestamp;
8. inserts the single row into `admin_bootstrap_state`.

Any failure rolls back all of it. In particular, an ineligible demo account
leaves no admin, no marker, and no audit row.

## Step 3 — verify

```sql
select id, email, role, faculty_status, member_type
from public.profiles
where role = 'admin';

select action, actor_id, actor_name, target_id, target_name, outcome, created_at
from public.admin_audit_log
where action = 'bootstrap';

select completed_at, completed_by, target_id, target_email
from public.admin_bootstrap_state;
```

Expected: exactly one admin, one bootstrap audit row, one marker row.

## Why the capability cannot create a second admin

Three independent guards:

1. `public.profiles_single_admin` — partial unique index on
   `(role) where role = 'admin'` (Phase 11).
2. The bootstrap script refuses when any admin exists.
3. The permanent `admin_bootstrap_state` marker makes every later run fail,
   even if the admin later resigns. Recovery after a resignation is the
   explicit operator `recover_admin(target, reason)` path, not a re-bootstrap.

After success the script has no stored function and no API endpoint. Re-running
it is a no-op that fails on the marker, so the one-time capability is disabled
at the database level. The repository keeps the file as documentation and for
the disposable rehearsal; it is inert in production.

## After the bootstrap: succession only

Only the current administrator may nominate; only the nominee may accept.

```sql
-- as the current admin (authenticated JWT)
select public.nominate_admin('<approved-faculty-profile-uuid>', 'handover');

-- as the nominee (authenticated JWT)
select public.accept_admin_nomination('<nomination-uuid>');
```

The acceptance transaction demotes the old admin to `faculty` and promotes the
nominee in that order, so the partial unique index never sees two admins.
Decline (`decline_admin_nomination`) and cancellation
(`cancel_admin_nomination`) leave the current administrator in place. All
paths write to `admin_audit_log`.

The nominee must already be:
- `role = 'faculty'`
- `faculty_status in ('approved', 'verified')`
- `member_type = 'faculty'`

A student — including the owner's personal student account — is not eligible
unless it independently completes the legitimate faculty approval flow.

## Rehearsal

```sh
bash supabase/local-rehearsal/run-rehearsal.sh
```

The rehearsal applies the canonical migrations to a disposable PostgreSQL 16
container, proves an ineligible demo account is refused, bootstraps the same
account after a simulated approval, exercises nomination/acceptance/decline/
cancel, and proves a second bootstrap is refused. It never contacts a hosted
project.
