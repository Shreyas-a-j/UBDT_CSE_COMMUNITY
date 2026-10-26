'use client';

/**
 * Composite community feed data.
 *
 * Mirrors the website's `CommunityContext` loading rules:
 *   - 40 newest posts (the website's window)
 *   - active discussion pins + the pinned posts themselves, even when they are
 *     older than the window
 *   - announcements with author + reaction rows
 *   - events from two days ago onward, ordered by date
 *   - the viewer's likes, upvotes and RSVPs
 *
 * Mutations are optimistic and revert on failure. No table is written outside
 * what the existing RLS policies allow for the signed-in member.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from './auth-context';
import { supabase } from './supabase';
import {
  ANNOUNCEMENT_SELECT,
  EVENT_SELECT,
  PIN_SELECT,
  POST_SELECT,
  mapAnnouncement,
  mapDiscussionPin,
  mapEvent,
  mapPost,
} from './community';
import { applyActivePinsToPosts, isEventUpcoming, pinErrorMessage } from './feed-logic';
import { logSupabaseError } from './errors';
import type {
  Announcement,
  AnnouncementReaction,
  DiscussionPin,
  Event,
  Post,
} from './types';

const POST_WINDOW = 40;
const EVENT_WINDOW = 40;
const ANNOUNCEMENT_WINDOW = 40;

export function useCommunityFeed() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const [posts, setPosts] = useState<Post[]>([]);
  const [pinnedPosts, setPinnedPosts] = useState<Post[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [upvotedIds, setUpvotedIds] = useState<Set<string>>(new Set());
  const [rsvpIds, setRsvpIds] = useState<Set<string>>(new Set());
  const [pinBusyIds, setPinBusyIds] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const mounted = useRef(true);
  const requestId = useRef(0);
  const reactionBusy = useRef<Set<string>>(new Set());

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * Loads only the active pins and their discussions. Split out of `load` so
   * a countdown expiry can refresh pins without refetching the whole feed.
   */
  const loadPins = useCallback(async (): Promise<{
    activePins: DiscussionPin[];
    pinned: Post[];
    error: string | null;
  }> => {
    const pinsRes = await supabase
      .from('discussion_pins')
      .select(PIN_SELECT)
      .is('unpinned_at', null)
      .gt('pin_expires_at', new Date().toISOString())
      .order('pinned_at', { ascending: false })
      .limit(3);

    if (pinsRes.error) {
      const message = pinsRes.error.message.toLowerCase();
      return {
        activePins: [],
        pinned: [],
        error:
          message.includes('does not exist') || message.includes('schema cache')
            ? null
            : pinsRes.error.message,
      };
    }

    const activePins = ((pinsRes.data ?? []) as Record<string, unknown>[])
      .map(mapDiscussionPin)
      .filter((pin): pin is DiscussionPin => pin !== null);

    let pinned: Post[] = [];
    let error: string | null = null;
    if (activePins.length > 0) {
      const ids = activePins.map((pin) => pin.post_id);
      let pinnedRes = await supabase.from('posts').select(POST_SELECT).in('id', ids);
      if (pinnedRes.error) {
        pinnedRes = await supabase.from('posts').select('*').in('id', ids);
      }
      if (pinnedRes.error) {
        error = pinnedRes.error.message;
      } else {
        const byId = new Map(
          ((pinnedRes.data ?? []) as unknown as Record<string, unknown>[])
            .map(mapPost)
            .map((post) => [post.id, post] as const)
        );
        pinned = activePins.flatMap((pin) => {
          const post = byId.get(pin.post_id);
          if (!post) return [];
          return [
            {
              ...post,
              pinned_at: pin.pinned_at,
              pin_expires_at: pin.pin_expires_at,
              pinned_by: pin.pinned_by,
            },
          ];
        });
      }
    }

    return { activePins, pinned, error };
  }, []);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (!mounted.current) return;
      const current = ++requestId.current;
      if (mode === 'initial') setLoading(true);
      else setRefreshing(true);
      setError(null);

      const errors: string[] = [];
      const minEventDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

      // Independent reads run together; a failing optional surface (pins,
      // announcements) must never blank the rest of the feed.
      const [postsRes, pinsResult, eventsRes, announcementRes, likesRes, upvotesRes, rsvpRes] =
        await Promise.all([
          supabase
            .from('posts')
            .select(POST_SELECT)
            .order('created_at', { ascending: false })
            .limit(POST_WINDOW),
          loadPins(),
          supabase
            .from('events')
            .select(EVENT_SELECT)
            .gte('event_date', minEventDate)
            .order('event_date', { ascending: true })
            .limit(EVENT_WINDOW),
          supabase
            .from('announcements')
            .select(ANNOUNCEMENT_SELECT)
            .order('created_at', { ascending: false })
            .limit(ANNOUNCEMENT_WINDOW),
          userId
            ? supabase.from('likes').select('post_id').eq('user_id', userId)
            : Promise.resolve({ data: [], error: null }),
          userId
            ? supabase.from('upvotes').select('post_id').eq('user_id', userId)
            : Promise.resolve({ data: [], error: null }),
          userId
            ? supabase.from('event_rsvps').select('event_id').eq('user_id', userId)
            : Promise.resolve({ data: [], error: null }),
        ]);

      if (!mounted.current || current !== requestId.current) return;

      /* ------------------------------- posts ------------------------------- */
      let postRows = postsRes.data as unknown as Record<string, unknown>[] | null;
      if (postsRes.error) {
        const fallback = await supabase
          .from('posts')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(POST_WINDOW);
        if (fallback.error) errors.push(fallback.error.message);
        postRows = fallback.data as unknown as Record<string, unknown>[] | null;
      }

      /* -------------------------------- pins ------------------------------- */
      const activePins = pinsResult.activePins;
      if (pinsResult.error) errors.push(pinsResult.error);

      const mappedPosts = (postRows ?? []).map(mapPost);
      const postsWithPins = applyActivePinsToPosts(mappedPosts, activePins);
      const pinned = pinsResult.pinned;

      /* ------------------------------- events ------------------------------ */
      let eventRows = eventsRes.data as unknown as Record<string, unknown>[] | null;
      if (eventsRes.error) {
        const fallback = await supabase
          .from('events')
          .select('*')
          .gte('event_date', minEventDate)
          .order('event_date', { ascending: true })
          .limit(EVENT_WINDOW);
        if (fallback.error) errors.push(fallback.error.message);
        eventRows = fallback.data as unknown as Record<string, unknown>[] | null;
      }

      /* --------------------------- announcements --------------------------- */
      let announcementRows =
        announcementRes.data as unknown as Record<string, unknown>[] | null;
      if (announcementRes.error) {
        const message = announcementRes.error.message.toLowerCase();
        const fallback = await supabase
          .from('announcements')
          .select('*, author:profiles!author_id (id, name, avatar_url, designation)')
          .order('created_at', { ascending: false })
          .limit(ANNOUNCEMENT_WINDOW);
        if (!fallback.error) {
          announcementRows = fallback.data as unknown as Record<string, unknown>[] | null;
        } else if (!message.includes('does not exist') && !message.includes('schema cache')) {
          errors.push(announcementRes.error.message);
        }
      }

      if (!mounted.current || current !== requestId.current) return;

      setPosts(postsWithPins);
      setPinnedPosts(pinned);
      setEvents((eventRows ?? []).map(mapEvent).filter((event) => isEventUpcoming(event)));
      setAnnouncements((announcementRows ?? []).map(mapAnnouncement));
      if (likesRes.data) setLikedIds(new Set(likesRes.data.map((row) => String(row.post_id))));
      if (upvotesRes.data) setUpvotedIds(new Set(upvotesRes.data.map((row) => String(row.post_id))));
      if (rsvpRes.data) setRsvpIds(new Set(rsvpRes.data.map((row) => String(row.event_id))));
      setError(errors.length > 0 ? errors[0] : null);
      setLoading(false);
      setRefreshing(false);
    },
    [loadPins, userId]
  );

  useEffect(() => {
    void load('initial');
  }, [load]);

  const refresh = useCallback(() => {
    void load('refresh');
  }, [load]);

  const retry = useCallback(() => {
    void load('initial');
  }, [load]);

  /** Focused pin refresh used by an expiring pin countdown. */
  const refreshPins = useCallback(async () => {
    const result = await loadPins();
    if (!mounted.current) return;
    setPinnedPosts(result.pinned);
    setPosts((previous) => applyActivePinsToPosts(previous, result.activePins));
  }, [loadPins]);

  /* ------------------------------- reactions ------------------------------ */

  const toggleLike = useCallback(
    async (postId: string) => {
      if (!userId) return;
      const wasLiked = likedIds.has(postId);
      setLikedIds((previous) => {
        const next = new Set(previous);
        if (wasLiked) next.delete(postId);
        else next.add(postId);
        return next;
      });
      setPosts((previous) =>
        previous.map((post) =>
          post.id === postId
            ? { ...post, like_count: Math.max(0, (post.like_count ?? 0) + (wasLiked ? -1 : 1)) }
            : post
        )
      );

      const { error: writeError } = wasLiked
        ? await supabase.from('likes').delete().eq('post_id', postId).eq('user_id', userId)
        : await supabase.from('likes').insert({ post_id: postId, user_id: userId });

      if (writeError) {
        setLikedIds((previous) => {
          const next = new Set(previous);
          if (wasLiked) next.add(postId);
          else next.delete(postId);
          return next;
        });
        setPosts((previous) =>
          previous.map((post) =>
            post.id === postId
              ? { ...post, like_count: Math.max(0, (post.like_count ?? 0) + (wasLiked ? 1 : -1)) }
              : post
          )
        );
        setActionError(writeError.message);
      }
    },
    [likedIds, userId]
  );

  const toggleUpvote = useCallback(
    async (postId: string) => {
      if (!userId) return;
      const wasUpvoted = upvotedIds.has(postId);
      setUpvotedIds((previous) => {
        const next = new Set(previous);
        if (wasUpvoted) next.delete(postId);
        else next.add(postId);
        return next;
      });
      setPosts((previous) =>
        previous.map((post) =>
          post.id === postId
            ? { ...post, upvote_count: Math.max(0, (post.upvote_count ?? 0) + (wasUpvoted ? -1 : 1)) }
            : post
        )
      );

      const { error: writeError } = wasUpvoted
        ? await supabase.from('upvotes').delete().eq('post_id', postId).eq('user_id', userId)
        : await supabase.from('upvotes').insert({ post_id: postId, user_id: userId });

      if (writeError) {
        setUpvotedIds((previous) => {
          const next = new Set(previous);
          if (wasUpvoted) next.add(postId);
          else next.delete(postId);
          return next;
        });
        setPosts((previous) =>
          previous.map((post) =>
            post.id === postId
              ? { ...post, upvote_count: Math.max(0, (post.upvote_count ?? 0) + (wasUpvoted ? 1 : -1)) }
              : post
          )
        );
        setActionError(writeError.message);
      }
    },
    [upvotedIds, userId]
  );

  const toggleRsvp = useCallback(
    async (event: Event) => {
      if (!userId) return;
      if (!isEventUpcoming(event)) {
        setActionError('This event has ended. RSVPs are closed.');
        return;
      }
      const wasGoing = rsvpIds.has(event.id);
      setRsvpIds((previous) => {
        const next = new Set(previous);
        if (wasGoing) next.delete(event.id);
        else next.add(event.id);
        return next;
      });
      setEvents((previous) =>
        previous.map((row) =>
          row.id === event.id
            ? { ...row, rsvp_count: Math.max(0, (row.rsvp_count ?? 0) + (wasGoing ? -1 : 1)) }
            : row
        )
      );

      const { error: writeError } = wasGoing
        ? await supabase.from('event_rsvps').delete().eq('event_id', event.id).eq('user_id', userId)
        : await supabase.from('event_rsvps').insert({ event_id: event.id, user_id: userId });

      if (writeError) {
        setRsvpIds((previous) => {
          const next = new Set(previous);
          if (wasGoing) next.add(event.id);
          else next.delete(event.id);
          return next;
        });
        setEvents((previous) =>
          previous.map((row) =>
            row.id === event.id
              ? { ...row, rsvp_count: Math.max(0, (row.rsvp_count ?? 0) + (wasGoing ? 1 : -1)) }
              : row
          )
        );
        setActionError(writeError.message);
      }
    },
    [rsvpIds, userId]
  );

  const toggleAnnouncementReaction = useCallback(
    async (announcementId: string, reaction: AnnouncementReaction) => {
      if (!userId || reactionBusy.current.has(announcementId)) return;
      const existing = announcements.find((item) => item.id === announcementId);
      const previousReaction =
        existing?.reactions.find((row) => row.user_id === userId)?.reaction ?? null;
      const nextReaction = previousReaction === reaction ? null : reaction;

      reactionBusy.current.add(announcementId);
      setAnnouncements((previous) =>
        previous.map((announcement) =>
          announcement.id === announcementId
            ? {
                ...announcement,
                reactions: [
                  ...announcement.reactions.filter((row) => row.user_id !== userId),
                  ...(nextReaction ? [{ user_id: userId, reaction: nextReaction }] : []),
                ],
              }
            : announcement
        )
      );

      try {
        if (previousReaction) {
          const { error: deleteError } = await supabase
            .from('announcement_reactions')
            .delete()
            .eq('announcement_id', announcementId)
            .eq('user_id', userId);
          if (deleteError) {
            setActionError(deleteError.message);
            void load('refresh');
            return;
          }
        }
        if (!nextReaction) return;

        const { error: insertError } = await supabase
          .from('announcement_reactions')
          .insert({ announcement_id: announcementId, user_id: userId, reaction: nextReaction });
        if (insertError) {
          setActionError(insertError.message);
          void load('refresh');
        }
      } finally {
        reactionBusy.current.delete(announcementId);
      }
    },
    [announcements, load, userId]
  );

  /* ---------------------------------- pins -------------------------------- */

  const togglePin = useCallback(
    async (postId: string) => {
      if (!userId || pinBusyIds.has(postId)) return;
      const currentlyPinned =
        pinnedPosts.some((post) => post.id === postId) ||
        posts.some((post) => post.id === postId && Boolean(post.pinned_at));

      setPinBusyIds((previous) => new Set(previous).add(postId));
      const { error: rpcError } = await supabase.rpc(
        currentlyPinned ? 'unpin_discussion' : 'pin_discussion',
        { p_discussion_id: postId }
      );

      if (rpcError) {
        logSupabaseError('Pin error', rpcError);
        setActionError(pinErrorMessage(rpcError.message));
        setPinBusyIds((previous) => {
          const next = new Set(previous);
          next.delete(postId);
          return next;
        });
        void refreshPins();
        return;
      }

      setPinBusyIds((previous) => {
        const next = new Set(previous);
        next.delete(postId);
        return next;
      });
      void refreshPins();
    },
    [pinBusyIds, pinnedPosts, posts, refreshPins, userId]
  );

  const clearActionError = useCallback(() => setActionError(null), []);

  return {
    posts,
    pinnedPosts,
    events,
    announcements,
    likedIds,
    upvotedIds,
    rsvpIds,
    pinBusyIds,
    loading,
    refreshing,
    error,
    actionError,
    refresh,
    retry,
    refreshPins,
    toggleLike,
    toggleUpvote,
    toggleRsvp,
    toggleAnnouncementReaction,
    togglePin,
    clearActionError,
  };
}
