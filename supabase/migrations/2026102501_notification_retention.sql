-- =========================================================
-- UCC 2.0 — notification retention, dedupe ledger, push log pruning
-- Date: 2026-10-25
--
-- Forward-only and additive. Safe to re-run.
--
-- In-app notifications live for 24 hours, then a batched server-side
-- cleanup deletes them. Push delivery state is never destroyed while a
-- notification is still pending, sending, or waiting for a retry.
--
-- Adds:
--   * notifications (created_at) index for the global retention scan.
--   * notification_dedupe_ledger — survives the in-app row so a deleted
--     notification can never authorize a duplicate push. Released keys
--     are pruned 30 days after release.
--   * notification_push_outbox.notification_id becomes nullable with
--     ON DELETE SET NULL; finished_at marks terminal delivery state.
--   * cleanup_expired_notifications() — batched, idempotent retention
--     plus terminal-log and released-ledger pruning.
--   * ensure_notification_retention_schedule() — creates/updates the
--     pg_cron job when the extension is installed.
--   * BEFORE INSERT dedupe guard on notifications (supplements the
--     existing unique index; that index remains the concurrency backstop).
--
-- Email is untouched. No new Edge Function or secret is introduced.
--
-- Rollback (manual; forward-only chain):
--   drop trigger if exists trg_guard_notification_dedupe on public.notifications;
--   drop function if exists public.guard_notification_dedupe();
--   drop function if exists public.ensure_notification_retention_schedule();
--   select cron.unschedule('ucc2-cleanup-expired-notifications');
--   drop function if exists public.cleanup_expired_notifications(interval, interval, interval, interval, integer, integer);
--   drop function if exists public.notification_push_outbox_is_terminal(text, timestamptz, timestamptz);
--   drop index if exists public.notification_push_outbox_terminal_idx;
--   alter table public.notification_push_outbox drop column if exists finished_at;
--   alter table public.notification_push_outbox drop constraint if exists notification_push_outbox_notification_id_fkey;
--   delete from public.notification_push_outbox where notification_id is null;
--   alter table public.notification_push_outbox alter column notification_id set not null;
--   alter table public.notification_push_outbox
--     add constraint notification_push_outbox_notification_id_fkey
--     foreign key (notification_id) references public.notifications(id) on delete cascade;
--   drop table if exists public.notification_dedupe_ledger;
--   drop index if exists public.notifications_created_at_idx;
-- =========================================================

-- ---------------------------------------------------------
-- 1. Retention scan index
-- ---------------------------------------------------------

create index if not exists notifications_created_at_idx
  on public.notifications (created_at);

-- ---------------------------------------------------------
-- 2. Dedupe ledger
--
-- The notification row is deleted after 24 hours. The ledger keeps the
-- (user_id, dedupe_key) pair so fan-out retries, trigger re-fires, and
-- provider replays cannot create a second in-app row or push job.
-- released_at is set when the notification is deleted; pruning waits
-- 30 days after release. Clients have no access.
-- ---------------------------------------------------------

create table if not exists public.notification_dedupe_ledger (
  user_id uuid not null references public.profiles(id) on delete cascade,
  dedupe_key text not null
    check (char_length(dedupe_key) between 1 and 200),
  created_at timestamp with time zone not null default now(),
  released_at timestamp with time zone,
  primary key (user_id, dedupe_key)
);

create index if not exists notification_dedupe_ledger_released_idx
  on public.notification_dedupe_ledger (released_at)
  where released_at is not null;

alter table public.notification_dedupe_ledger enable row level security;
revoke all on public.notification_dedupe_ledger from anon, authenticated;

-- Backfill from notifications that still exist. Earliest creation wins.
insert into public.notification_dedupe_ledger (user_id, dedupe_key, created_at)
select n.user_id, n.dedupe_key, min(n.created_at)
from public.notifications n
where n.dedupe_key is not null
group by n.user_id, n.dedupe_key
on conflict (user_id, dedupe_key) do nothing;

-- BEFORE INSERT guard: a duplicate key is suppressed before the existing
-- unique index sees it. Returning NULL makes the insert a no-op, which
-- matches the prior ON CONFLICT DO NOTHING behaviour. The trigger runs
-- as its owner so the client lockout on the ledger is not a problem.
create or replace function public.guard_notification_dedupe()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.dedupe_key is null then
    return new;
  end if;

  insert into public.notification_dedupe_ledger (user_id, dedupe_key, created_at)
  values (new.user_id, new.dedupe_key, coalesce(new.created_at, now()))
  on conflict (user_id, dedupe_key) do nothing;

  if not found then
    return null;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_notification_dedupe() from public;
revoke all on function public.guard_notification_dedupe() from anon;
revoke all on function public.guard_notification_dedupe() from authenticated;

drop trigger if exists trg_guard_notification_dedupe on public.notifications;
create trigger trg_guard_notification_dedupe
  before insert on public.notifications
  for each row execute procedure public.guard_notification_dedupe();

-- ---------------------------------------------------------
-- 3. Push outbox: detachable notification link + terminal marker
--
-- A delivered or permanently failed log is kept for a short window, then
-- pruned. Deletion of the in-app row only detaches the log; it never
-- deletes a pending job and never re-sends a delivered push.
-- ---------------------------------------------------------

alter table public.notification_push_outbox
  alter column notification_id drop not null;

alter table public.notification_push_outbox
  drop constraint if exists notification_push_outbox_notification_id_fkey;

alter table public.notification_push_outbox
  add constraint notification_push_outbox_notification_id_fkey
  foreign key (notification_id) references public.notifications(id)
  on delete set null;

alter table public.notification_push_outbox
  add column if not exists finished_at timestamp with time zone;

-- Backfill terminal timestamps from the old worker's rows. Preserve the
-- original terminal age; do not grant a fresh retention window.
update public.notification_push_outbox
set finished_at = coalesce(sent_at, updated_at, created_at)
where status in ('sent', 'skipped')
  and finished_at is null;

update public.notification_push_outbox
set finished_at = coalesce(updated_at, created_at)
where status = 'failed'
  and finished_at is null
  and next_attempt_at > now() + interval '1 day';

create index if not exists notification_push_outbox_terminal_idx
  on public.notification_push_outbox (status, finished_at)
  where finished_at is not null;

-- One terminal predicate for cleanup, pruning, and tests.
create or replace function public.notification_push_outbox_is_terminal(
  p_status text,
  p_finished_at timestamp with time zone,
  p_next_attempt_at timestamp with time zone
)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when p_status in ('sent', 'skipped') then true
    when p_status = 'failed' then
      p_finished_at is not null
      or (p_next_attempt_at is not null
          and p_next_attempt_at > now() + interval '1 day')
    else false
  end;
$$;

revoke all on function public.notification_push_outbox_is_terminal(
  text, timestamp with time zone, timestamp with time zone
) from public;
revoke all on function public.notification_push_outbox_is_terminal(
  text, timestamp with time zone, timestamp with time zone
) from anon;
revoke all on function public.notification_push_outbox_is_terminal(
  text, timestamp with time zone, timestamp with time zone
) from authenticated;

-- ---------------------------------------------------------
-- 4. Batched retention cleanup
--
-- 1. Backfill any terminal rows settled by the old worker.
-- 2. Delete expired notifications in bounded batches, skipping any row
--    with a non-terminal push job. The FK detaches terminal logs.
-- 3. Release dedupe keys for deleted rows; sweep manual-delete orphans.
-- 4. Prune sent/skipped logs after 7 days and terminal failed logs after
--    30 days.
-- 5. Prune released dedupe keys after 30 days when no notification still
--    references the key.
--
-- Repeated calls are harmless. All timestamp comparisons use timestamptz
-- and one captured now(); UTC storage makes the cutoff absolute.
-- ---------------------------------------------------------

create or replace function public.cleanup_expired_notifications(
  p_notification_retention interval default interval '24 hours',
  p_dedupe_retention interval default interval '30 days',
  p_success_log_retention interval default interval '7 days',
  p_failure_log_retention interval default interval '30 days',
  p_batch_size integer default 1000,
  p_max_batches integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamp with time zone := now();
  v_cutoff timestamp with time zone;
  v_deleted_total bigint := 0;
  v_released_total bigint := 0;
  v_batch_deleted bigint;
  v_batch_released bigint;
  v_batches integer := 0;
  v_orphan_released bigint := 0;
  v_success_pruned bigint := 0;
  v_failed_pruned bigint := 0;
  v_dedupe_pruned bigint := 0;
  v_remaining bigint := 0;
  v_summary jsonb;
begin
  if p_notification_retention is null or p_notification_retention < interval '0' then
    raise exception 'p_notification_retention must be a non-negative interval';
  end if;
  if p_dedupe_retention is null or p_dedupe_retention < interval '0' then
    raise exception 'p_dedupe_retention must be a non-negative interval';
  end if;
  if p_success_log_retention is null or p_success_log_retention < interval '0' then
    raise exception 'p_success_log_retention must be a non-negative interval';
  end if;
  if p_failure_log_retention is null or p_failure_log_retention < interval '0' then
    raise exception 'p_failure_log_retention must be a non-negative interval';
  end if;
  if p_batch_size is null or p_batch_size <= 0 then
    raise exception 'p_batch_size must be positive';
  end if;
  if p_max_batches is null or p_max_batches <= 0 then
    raise exception 'p_max_batches must be positive';
  end if;

  v_cutoff := v_now - p_notification_retention;

  -- Old worker settlements have no finished_at. Stamp them from the
  -- original terminal time so retention is not extended.
  update public.notification_push_outbox
  set finished_at = coalesce(sent_at, updated_at, created_at)
  where status in ('sent', 'skipped')
    and finished_at is null;

  update public.notification_push_outbox
  set finished_at = coalesce(updated_at, created_at)
  where status = 'failed'
    and finished_at is null
    and next_attempt_at > v_now + interval '1 day';

  loop
    exit when v_batches >= p_max_batches;

    with expired as (
      select n.id
      from public.notifications n
      where n.created_at < v_cutoff
        and not exists (
          select 1
          from public.notification_push_outbox o
          where o.notification_id = n.id
            and not public.notification_push_outbox_is_terminal(
              o.status, o.finished_at, o.next_attempt_at
            )
        )
      order by n.created_at, n.id
      limit p_batch_size
      for update of n skip locked
    ),
    deleted as (
      delete from public.notifications n
      using expired e
      where n.id = e.id
      returning n.user_id, n.dedupe_key
    ),
    released as (
      update public.notification_dedupe_ledger l
      set released_at = v_now
      from deleted d
      where d.dedupe_key is not null
        and l.user_id = d.user_id
        and l.dedupe_key = d.dedupe_key
        and l.released_at is null
      returning 1
    )
    select
      (select count(*) from deleted),
      (select count(*) from released)
    into v_batch_deleted, v_batch_released;

    v_batches := v_batches + 1;
    v_deleted_total := v_deleted_total + v_batch_deleted;
    v_released_total := v_released_total + v_batch_released;

    exit when v_batch_deleted = 0;
    exit when v_batch_deleted < p_batch_size;
  end loop;

  -- A notification removed outside this function still leaves a ledger
  -- row. Release it now so it can age out normally.
  update public.notification_dedupe_ledger l
  set released_at = v_now
  where l.released_at is null
    and not exists (
      select 1
      from public.notifications n
      where n.user_id = l.user_id
        and n.dedupe_key = l.dedupe_key
    );
  get diagnostics v_orphan_released = row_count;
  v_released_total := v_released_total + v_orphan_released;

  delete from public.notification_push_outbox o
  where o.status in ('sent', 'skipped')
    and coalesce(o.finished_at, o.sent_at, o.updated_at, o.created_at)
        < v_now - p_success_log_retention;
  get diagnostics v_success_pruned = row_count;

  delete from public.notification_push_outbox o
  where o.status = 'failed'
    and public.notification_push_outbox_is_terminal(
      o.status, o.finished_at, o.next_attempt_at
    )
    and coalesce(o.finished_at, o.updated_at, o.created_at)
        < v_now - p_failure_log_retention;
  get diagnostics v_failed_pruned = row_count;

  delete from public.notification_dedupe_ledger l
  where l.released_at is not null
    and l.released_at < v_now - p_dedupe_retention
    and not exists (
      select 1
      from public.notifications n
      where n.user_id = l.user_id
        and n.dedupe_key = l.dedupe_key
    );
  get diagnostics v_dedupe_pruned = row_count;

  select count(*)
  into v_remaining
  from public.notifications n
  where n.created_at < v_cutoff
    and not exists (
      select 1
      from public.notification_push_outbox o
      where o.notification_id = n.id
        and not public.notification_push_outbox_is_terminal(
          o.status, o.finished_at, o.next_attempt_at
        )
    );

  v_summary := jsonb_build_object(
    'cutoff', v_cutoff,
    'deleted_notifications', v_deleted_total,
    'released_dedupe_keys', v_released_total,
    'pruned_success_logs', v_success_pruned,
    'pruned_failed_logs', v_failed_pruned,
    'pruned_dedupe_keys', v_dedupe_pruned,
    'batches', v_batches,
    'remaining_expired_notifications', v_remaining
  );

  raise notice
    'notification retention: deleted=% released=% pruned_success=% pruned_failed=% pruned_dedupe=% batches=% remaining=%',
    v_deleted_total, v_released_total, v_success_pruned, v_failed_pruned,
    v_dedupe_pruned, v_batches, v_remaining;

  return v_summary;
end;
$$;

revoke all on function public.cleanup_expired_notifications(
  interval, interval, interval, interval, integer, integer
) from public;
revoke all on function public.cleanup_expired_notifications(
  interval, interval, interval, interval, integer, integer
) from anon;
revoke all on function public.cleanup_expired_notifications(
  interval, interval, interval, interval, integer, integer
) from authenticated;

-- ---------------------------------------------------------
-- 5. Schedule helper
--
-- pg_cron is not installed by default. On hosted Supabase it can be
-- enabled through the Dashboard or the Management API
-- (`create extension pg_cron with schema pg_catalog;`); a direct
-- non-superuser connection may be rejected. This helper is safe to
-- call before it is enabled: it raises a notice and returns false.
-- After enabling, run `select public.ensure_notification_retention_schedule();`.
-- ---------------------------------------------------------

create or replace function public.ensure_notification_retention_schedule()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_jobname text := 'ucc2-cleanup-expired-notifications';
  v_schedule text := '*/15 * * * *';
  v_command text := 'select public.cleanup_expired_notifications();';
  v_exists boolean;
begin
  if not exists (
    select 1 from pg_extension where extname = 'pg_cron'
  ) then
    raise notice
      'pg_cron is not installed; notification retention schedule was not created';
    return false;
  end if;

  execute 'select exists (select 1 from cron.job where jobname = $1)'
    into v_exists
    using v_jobname;

  if v_exists then
    execute
      'select cron.alter_job(jobid, schedule := $1, command := $2, active := true)
         from cron.job
        where jobname = $3
        order by jobid
        limit 1'
      using v_schedule, v_command, v_jobname;
  else
    execute 'select cron.schedule($1, $2, $3)'
      using v_jobname, v_schedule, v_command;
  end if;

  return true;
end;
$$;

revoke all on function public.ensure_notification_retention_schedule() from public;
revoke all on function public.ensure_notification_retention_schedule() from anon;
revoke all on function public.ensure_notification_retention_schedule() from authenticated;

-- No-op on a database without pg_cron; creates/updates the job when it is
-- already available. The operator re-runs this after enabling the extension.
select public.ensure_notification_retention_schedule();

notify pgrst, 'reload schema';
