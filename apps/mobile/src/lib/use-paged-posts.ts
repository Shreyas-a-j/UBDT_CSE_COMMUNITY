'use client';

/**
 * Paginated community feed backed by the real `public.posts` table.
 *
 * - Server-side pagination via PostgREST `.range()`.
 * - Embedded author profile + engagement counts in one query.
 * - Falls back to a plain `posts` select if the relationship embed fails, so
 *   an older schema still renders real authors-less rows instead of an error.
 * - Optimistic like/upvote toggles; a failed write refreshes the page so the
 *   UI never keeps a count the database rejected.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './auth-context';
import { supabase } from './supabase';
import { POST_SELECT, mapPost } from './community';
import type { Post, PostType } from './types';

export const FEED_PAGE_SIZE = 12;
export type FeedFilter = 'all' | PostType;

type Mode = 'initial' | 'refresh' | 'more';

export function usePagedPosts(filter: FeedFilter) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [upvotedIds, setUpvotedIds] = useState<Set<string>>(new Set());

  const mounted = useRef(true);
  const postsRef = useRef<Post[]>([]);
  const hasMoreRef = useRef(true);
  const loadingMoreRef = useRef(false);
  const requestId = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    postsRef.current = posts;
  }, [posts]);

  const loadPage = useCallback(
    async (mode: Mode) => {
      if (!mounted.current) return;
      if (mode === 'more' && (loadingMoreRef.current || !hasMoreRef.current)) return;

      const reset = mode !== 'more';
      const currentRequest = reset ? ++requestId.current : requestId.current;
      const offset = reset ? 0 : postsRef.current.length;

      if (mode === 'initial') {
        setLoading(true);
      } else if (mode === 'refresh') {
        setRefreshing(true);
      } else {
        loadingMoreRef.current = true;
        setLoadingMore(true);
      }

      try {
        let query = supabase
          .from('posts')
          .select(POST_SELECT)
          .order('created_at', { ascending: false })
          .range(offset, offset + FEED_PAGE_SIZE - 1);

        if (filter !== 'all') query = query.eq('type', filter);

        let result = await query;

        if (result.error) {
          let fallback = supabase
            .from('posts')
            .select('*')
            .order('created_at', { ascending: false })
            .range(offset, offset + FEED_PAGE_SIZE - 1);
          if (filter !== 'all') fallback = fallback.eq('type', filter);
          result = await fallback;
        }

        if (!mounted.current || currentRequest !== requestId.current) return;

        if (result.error) {
          setError(result.error.message || 'The feed could not be loaded.');
          if (mode === 'initial') setPosts([]);
          return;
        }

        const rows = (result.data ?? []) as unknown as Record<string, unknown>[];
        const mapped = rows.map(mapPost).filter((post) => Boolean(post.id));
        setError(null);

        if (reset) {
          setPosts(mapped);
          postsRef.current = mapped;
          setHasMore(mapped.length === FEED_PAGE_SIZE);
          hasMoreRef.current = mapped.length === FEED_PAGE_SIZE;
        } else {
          setPosts((previous) => {
            const seen = new Set(previous.map((post) => post.id));
            const next = [...previous, ...mapped.filter((post) => !seen.has(post.id))];
            postsRef.current = next;
            return next;
          });
          const more = mapped.length === FEED_PAGE_SIZE;
          setHasMore(more);
          hasMoreRef.current = more;
        }
      } catch (caught) {
        if (!mounted.current) return;
        setError(caught instanceof Error ? caught.message : 'The feed could not be loaded.');
      } finally {
        if (mounted.current) {
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
          loadingMoreRef.current = false;
        }
      }
    },
    [filter]
  );

  useEffect(() => {
    setLoading(true);
    setPosts([]);
    postsRef.current = [];
    setHasMore(true);
    hasMoreRef.current = true;
    void loadPage('initial');
  }, [filter, loadPage]);

  const refresh = useCallback(() => {
    void loadPage('refresh');
  }, [loadPage]);

  const loadMore = useCallback(() => {
    void loadPage('more');
  }, [loadPage]);

  const retry = useCallback(() => {
    void loadPage('initial');
  }, [loadPage]);

  useEffect(() => {
    let active = true;
    if (!userId) {
      setLikedIds(new Set());
      setUpvotedIds(new Set());
      return;
    }
    void Promise.all([
      supabase.from('likes').select('post_id').eq('user_id', userId),
      supabase.from('upvotes').select('post_id').eq('user_id', userId),
    ]).then(([likes, upvotes]) => {
      if (!active) return;
      if (likes.data) setLikedIds(new Set(likes.data.map((row) => String(row.post_id))));
      if (upvotes.data) setUpvotedIds(new Set(upvotes.data.map((row) => String(row.post_id))));
    });
    return () => {
      active = false;
    };
  }, [userId]);

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
        setError(writeError.message);
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
        setError(writeError.message);
      }
    },
    [upvotedIds, userId]
  );

  return useMemo(
    () => ({
      posts,
      loading,
      refreshing,
      loadingMore,
      hasMore,
      error,
      likedIds,
      upvotedIds,
      refresh,
      loadMore,
      retry,
      toggleLike,
      toggleUpvote,
    }),
    [
      posts,
      loading,
      refreshing,
      loadingMore,
      hasMore,
      error,
      likedIds,
      upvotedIds,
      refresh,
      loadMore,
      retry,
      toggleLike,
      toggleUpvote,
    ]
  );
}
