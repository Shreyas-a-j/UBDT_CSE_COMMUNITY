-- =========================================================
-- UCC 2.0 — Android push, part 2: publish + showcase triggers
-- Date: 2026-10-24
--
-- Forward-only and additive after 2026102401. Safe to re-run.
--
-- * Announcement/event INSERT still emits one in-app row per eligible
--   recipient. It now also enqueues exactly one OneSignal push row and
--   no longer writes the email outbox.
-- * Showcase ranking is recomputed from trusted database state only:
--     eligible = type='showcase' AND at least one upvote
--     order    = upvotes desc, created_at desc, id asc
--     cap      = 2
--   A durable tenure row is opened on genuine entry, closed on departure,
--   and a later re-entry gets a new entry_seq and therefore a new push.
--   Recalculation, feed refreshes, edits and continuing membership never
--   repeat a notification.
-- * The migration seeds already-current top-two projects as notified so
--   deploying this change does not blast historical entries.
--
-- Rollback (manual):
--   drop trigger if exists trg_showcase_ranking_upvote_update on public.upvotes;
--   drop trigger if exists trg_showcase_ranking_upvote_delete on public.upvotes;
--   drop trigger if exists trg_showcase_ranking_upvote_insert on public.upvotes;
--   drop trigger if exists trg_showcase_ranking_post_update on public.posts;
--   drop trigger if exists trg_showcase_ranking_post_delete on public.posts;
--   drop trigger if exists trg_showcase_ranking_post_insert on public.posts;
--   drop function if exists public.on_showcase_ranking_change();
--   drop function if exists public.recompute_showcase_top2();
--   -- restore the pre-push publish function from 2026102304 manually.
-- =========================================================

-- ---------------------------------------------------------
-- 1. Publish fan-out: in-app + push, never email
-- ---------------------------------------------------------

create or replace function public.on_publish_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_type text;
  v_publisher uuid;
  v_title text;
  v_body text;
  v_link text;
  v_recipient uuid;
  v_notification_id uuid;
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
    -- In-app first. A failure rolls the publish back loudly; a publish
    -- must never exist without its community notification.
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

    select n.id into v_notification_id
    from public.notifications n
    where n.user_id = v_recipient
      and n.dedupe_key = 'publish:' || v_kind || ':' || new.id;

    if v_notification_id is not null
       and coalesce((
         select p.push_enabled
         from public.notification_preferences p
         where p.user_id = v_recipient
       ), true) then
      insert into public.notification_push_outbox (
        notification_id, user_id, source_type, source_id
      ) values (
        v_notification_id, v_recipient, v_kind, new.id
      )
      on conflict (notification_id) do nothing;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_publish_fanout_announcement on public.announcements;
create trigger trg_publish_fanout_announcement
after insert on public.announcements
for each row execute procedure public.on_publish_notification();

drop trigger if exists trg_publish_fanout_event on public.events;
create trigger trg_publish_fanout_event
after insert on public.events
for each row execute procedure public.on_publish_notification();

-- ---------------------------------------------------------
-- 2. Recompute showcase top two
--
-- The advisory lock serializes concurrent post/upvote writers so the
-- active-tenure diff is computed against one stable ranking. The lock is
-- transaction-scoped and released on commit/rollback.
-- ---------------------------------------------------------

create or replace function public.recompute_showcase_top2()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_top_ids uuid[] := '{}'::uuid[];
  v_post record;
  v_entry_id uuid;
  v_seq integer;
  v_notification_id uuid;
  v_dedupe_key text;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('public.showcase_top2_ranking', 0)
  );

  select coalesce(array_agg(r.id order by r.rank_order), '{}'::uuid[])
  into v_top_ids
  from (
    select
      p.id,
      row_number() over (
        order by count(u.id) desc, p.created_at desc, p.id asc
      ) as rank_order
    from public.posts p
    join public.upvotes u on u.post_id = p.id
    where p.type = 'showcase'
    group by p.id
    order by count(u.id) desc, p.created_at desc, p.id asc
    limit 2
  ) r;

  -- Close every active tenure that is no longer in the current top two.
  -- Skip posts that are already gone: a showcase DELETE cascades to its
  -- tenure rows in the same statement, and updating a tenure whose parent
  -- post was just removed would violate the FK before the cascade lands.
  update public.showcase_top_entries e
  set left_at = timezone('utc'::text, now())
  where e.left_at is null
    and not (e.post_id = any(v_top_ids))
    and exists (
      select 1 from public.posts p where p.id = e.post_id
    );

  for v_post in
    select p.id, p.author_id, p.title
    from public.posts p
    where p.id = any(v_top_ids)
  loop
    select e.id into v_entry_id
    from public.showcase_top_entries e
    where e.post_id = v_post.id
      and e.left_at is null;

    if v_entry_id is null then
      select coalesce(max(e.entry_seq), 0) + 1 into v_seq
      from public.showcase_top_entries e
      where e.post_id = v_post.id;

      insert into public.showcase_top_entries (post_id, entry_seq)
      values (v_post.id, v_seq)
      returning id into v_entry_id;

      v_dedupe_key := 'showcase_top2:' || v_post.id || ':' || v_seq;

      insert into public.notifications (
        user_id, type, title, body, link,
        content_type, content_id, dedupe_key
      ) values (
        v_post.author_id,
        'showcase_top2',
        'Your showcase is in the top two',
        left(v_post.title, 160),
        '/#showcase-' || v_post.id,
        'showcase',
        v_post.id,
        v_dedupe_key
      )
      on conflict (user_id, dedupe_key) where dedupe_key is not null
      do nothing
      returning id into v_notification_id;

      if v_notification_id is null then
        select n.id into v_notification_id
        from public.notifications n
        where n.user_id = v_post.author_id
          and n.dedupe_key = v_dedupe_key;
      end if;

      if v_notification_id is not null then
        update public.showcase_top_entries
        set notification_id = v_notification_id,
            notified_at = timezone('utc'::text, now())
        where id = v_entry_id;

        if coalesce((
          select p.push_enabled
          from public.notification_preferences p
          where p.user_id = v_post.author_id
        ), true) then
          insert into public.notification_push_outbox (
            notification_id, user_id, source_type, source_id
          ) values (
            v_notification_id, v_post.author_id, 'showcase_top2', v_post.id
          )
          on conflict (notification_id) do nothing;
        end if;
      end if;
    end if;
  end loop;
end;
$$;

create or replace function public.on_showcase_ranking_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recompute_showcase_top2();
  return null;
end;
$$;

drop trigger if exists trg_showcase_ranking_post_insert on public.posts;
create trigger trg_showcase_ranking_post_insert
after insert on public.posts
for each row execute procedure public.on_showcase_ranking_change();

drop trigger if exists trg_showcase_ranking_post_delete on public.posts;
create trigger trg_showcase_ranking_post_delete
after delete on public.posts
for each row execute procedure public.on_showcase_ranking_change();

-- Edits are not publications. Only fields that can change ranking or
-- ownership re-run the diff; even then a continuing member is silent.
drop trigger if exists trg_showcase_ranking_post_update on public.posts;
create trigger trg_showcase_ranking_post_update
after update of type, author_id, created_at on public.posts
for each row execute procedure public.on_showcase_ranking_change();

drop trigger if exists trg_showcase_ranking_upvote_insert on public.upvotes;
create trigger trg_showcase_ranking_upvote_insert
after insert on public.upvotes
for each row execute procedure public.on_showcase_ranking_change();

drop trigger if exists trg_showcase_ranking_upvote_delete on public.upvotes;
create trigger trg_showcase_ranking_upvote_delete
after delete on public.upvotes
for each row execute procedure public.on_showcase_ranking_change();

drop trigger if exists trg_showcase_ranking_upvote_update on public.upvotes;
create trigger trg_showcase_ranking_upvote_update
after update of post_id, user_id on public.upvotes
for each row execute procedure public.on_showcase_ranking_change();

-- ---------------------------------------------------------
-- 3. Deployment baseline
--
-- Current top-two projects are already in the top two. Seed their active
-- tenure with notified_at set and no notification_id so the first later
-- recalculation does not re-announce history.
-- ---------------------------------------------------------

insert into public.showcase_top_entries (
  post_id, entry_seq, entered_at, notified_at
)
select r.id, 1, timezone('utc'::text, now()), timezone('utc'::text, now())
from (
  select p.id
  from public.posts p
  join public.upvotes u on u.post_id = p.id
  where p.type = 'showcase'
  group by p.id
  order by count(u.id) desc, p.created_at desc, p.id asc
  limit 2
) r
on conflict do nothing;

-- ---------------------------------------------------------
-- 4. Lock database-only functions away from API roles
-- ---------------------------------------------------------

revoke all on function public.recompute_showcase_top2() from public;
revoke all on function public.recompute_showcase_top2() from anon, authenticated;
revoke all on function public.on_showcase_ranking_change() from public;
revoke all on function public.on_showcase_ranking_change() from anon, authenticated;
revoke all on function public.on_publish_notification() from public;
revoke all on function public.on_publish_notification() from anon, authenticated;

notify pgrst, 'reload schema';
