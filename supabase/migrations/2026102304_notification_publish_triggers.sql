-- =========================================================
-- UCC 2.0 — publish fan-out, part 2: AFTER INSERT triggers
-- Date: 2026-10-23
--
-- Forward-only and additive. Safe to re-run.
--
-- Part 2 of notifications for published announcements/events. Part 1
-- (2026102303) added the constraint values, the email preference table
-- and the email outbox these triggers consume.
--
-- Behaviour:
--   * INSERT into public.announcements or public.events = published.
--     UPDATE (edits) never fires this workflow: the triggers are
--     AFTER INSERT only.
--   * Every eligible recipient gets exactly one in-app notification via
--     the existing emit_notification() (dedupe_key
--     'publish:<kind>:<id>' against the unique (user_id, dedupe_key)
--     index) and exactly one email outbox row (UNIQUE
--     (source_type, source_id, user_id) + ON CONFLICT DO NOTHING).
--   * Eligibility (publish_recipient_ids): profile exists AND
--     auth.users.email_confirmed_at not null AND not banned
--     (banned_until null or past) AND not deleted (deleted_at null)
--     AND not the publisher. Evaluated once per publish, so the in-app
--     and email sets always agree.
--   * Failure policy: an in-app fan-out error PROPAGATES — the publish
--     is rejected atomically (no half-fanned-out publish can exist).
--     An outbox enqueue error is TRAPPED (savepoint + RAISE WARNING):
--     per the requirement, email trouble must never roll back the
--     publication or suppress the in-app rows.
--   * SECURITY DEFINER with search_path pinned; EXECUTE revoked from
--     PUBLIC, anon and authenticated — only the database fires these
--     (Postgres does not check EXECUTE on trigger invocation).
--
-- Rollback (manual; the chain is forward-only):
--   drop trigger if exists trg_publish_fanout_announcement on public.announcements;
--   drop trigger if exists trg_publish_fanout_event on public.events;
--   drop function if exists public.on_publish_notification();
--   drop function if exists public.publish_recipient_ids(uuid);
--   -- fan-out rows already emitted are data, not schema; remove only
--   -- with the publish itself, or explicitly:
--   --   delete from public.notifications where dedupe_key like 'publish:%';
--   --   delete from public.notification_email_outbox
--   --     where source_type in ('announcement', 'event');
-- =========================================================

-- ---------------------------------------------------------
-- 1. Recipient eligibility
--
-- One deterministic query shared by both channels. Reads auth.users
-- directly (security definer) so clients can neither call it nor infer
-- who else was notified. Returns no row for the publisher; a null
-- publisher argument (defensive) still returns the full eligible set.
-- ---------------------------------------------------------

create or replace function public.publish_recipient_ids(p_publisher uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.profiles p
  join auth.users u on u.id = p.id
  where u.email_confirmed_at is not null
    and (u.banned_until is null or u.banned_until <= now())
    and u.deleted_at is null
    and (p_publisher is null or p.id <> p_publisher);
$$;

-- ---------------------------------------------------------
-- 2. The publish fan-out trigger function
--
-- Branches on TG_TABLE_NAME so one function serves both publishers.
-- Unknown table = silent no-op (defensive; both attachments below are
-- explicit).
-- ---------------------------------------------------------

create or replace function public.on_publish_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;        -- content_type / outbox source_type
  v_type text;        -- notifications.type
  v_publisher uuid;
  v_title text;
  v_body text;
  v_link text;
  v_recipient uuid;
begin
  if tg_table_name = 'announcements' then
    v_kind := 'announcement';
    v_type := 'announcement';
    v_publisher := new.author_id;
    v_title := left(new.title, 200);
    v_body := left(new.body, 160);
    v_link := '/announcements#announcement-' || new.id;
  elsif tg_table_name = 'events' then
    v_kind := 'event';
    v_type := 'event_published';
    v_publisher := new.host_id;
    v_title := left(new.title, 200);
    v_body := new.type || ' · ' || to_char(new.event_date, 'Dy, Mon DD, YYYY')
              || ' · ' || to_char(new.event_time, 'HH24:MI');
    v_link := '/#event-' || new.id;
  else
    return new;
  end if;

  for v_recipient in
    select * from public.publish_recipient_ids(v_publisher)
  loop
    -- In-app row first: any failure here must roll the publish back
    -- loudly (statement-level atomicity) rather than publish content
    -- that half the community never learns about.
    perform public.emit_notification(
      v_recipient,
      v_type,
      v_title,
      v_body,
      v_link,
      v_kind,
      new.id,
      'publish:' || v_kind || ':' || new.id
    );

    -- Email work item: best-effort by requirement. A trap + warning
    -- keeps a broken queue from ever blocking publication or removing
    -- in-app rows; the unique key makes re-enqueue a no-op.
    begin
      insert into public.notification_email_outbox (source_type, source_id, user_id)
      values (v_kind, new.id, v_recipient)
      on conflict (source_type, source_id, user_id) do nothing;
    exception when others then
      raise warning 'publish fan-out: email enqueue failed for % % -> user %: %',
        v_kind, new.id, v_recipient, sqlerrm;
    end;
  end loop;

  return new;
end;
$$;

-- ---------------------------------------------------------
-- 3. Trigger attachments — AFTER INSERT only, never UPDATE
-- ---------------------------------------------------------

drop trigger if exists trg_publish_fanout_announcement on public.announcements;
create trigger trg_publish_fanout_announcement
after insert on public.announcements
for each row execute procedure public.on_publish_notification();

drop trigger if exists trg_publish_fanout_event on public.events;
create trigger trg_publish_fanout_event
after insert on public.events
for each row execute procedure public.on_publish_notification();

-- ---------------------------------------------------------
-- 4. Lock both functions to the database itself
-- ---------------------------------------------------------

revoke all on function public.publish_recipient_ids(uuid) from public;
revoke all on function public.publish_recipient_ids(uuid) from anon, authenticated;
revoke all on function public.on_publish_notification() from public;
revoke all on function public.on_publish_notification() from anon, authenticated;

-- ---------------------------------------------------------
-- 5. Reload PostgREST schema cache
-- ---------------------------------------------------------

notify pgrst, 'reload schema';
