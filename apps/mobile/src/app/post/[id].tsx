'use client';

/**
 * Post detail: full discussion/showcase content, real engagement actions and
 * the live comment thread. Comments and the composer share a KeyboardAvoiding
 * layout that keeps the input above the Android keyboard.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import {
  COMMENT_SELECT,
  POST_SELECT,
  formatRelativeTime,
  getYearLabel,
  mapPost,
  sanitizeText,
} from '@/lib/community';
import { logSupabaseError } from '@/lib/errors';
import { Brand, Type } from '@/lib/theme';
import type { Comment, Post } from '@/lib/types';
import { Avatar } from '@/components/avatar';
import { Badge } from '@/components/badge';
import { Screen, BackHeader } from '@/components/layout';
import { PostSkeleton } from '@/components/skeleton';
import { EmptyState, ErrorState } from '@/components/states';
import { ActionButton, Chip, StatusBanner } from '@/components/ui';

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, profile } = useAuth();
  const insets = useSafeAreaInsets();
  const userId = session?.user.id ?? null;

  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liked, setLiked] = useState(false);
  const [upvoted, setUpvoted] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const listRef = useRef<FlatList<Comment>>(null);

  const load = useCallback(async () => {
    if (!id) {
      setError('This post could not be found.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    let postResult = await supabase.from('posts').select(POST_SELECT).eq('id', id).maybeSingle();
    if (postResult.error) {
      postResult = await supabase.from('posts').select('*').eq('id', id).maybeSingle();
    }

    if (postResult.error) {
      logSupabaseError('Post detail error', postResult.error);
      setError(postResult.error.message || 'This post could not be loaded.');
      setLoading(false);
      return;
    }

    if (!postResult.data) {
      setPost(null);
      setError('This post may have been deleted.');
      setLoading(false);
      return;
    }

    setPost(mapPost(postResult.data as Record<string, unknown>));

    let commentsResult = await supabase
      .from('comments')
      .select(COMMENT_SELECT)
      .eq('post_id', id)
      .order('created_at', { ascending: true })
      .limit(150);

    if (commentsResult.error) {
      commentsResult = await supabase
        .from('comments')
        .select('*')
        .eq('post_id', id)
        .order('created_at', { ascending: true })
        .limit(150);
    }

    if (!commentsResult.error && commentsResult.data) {
      setComments(
        (commentsResult.data as unknown as Record<string, unknown>[]).map((row) => {
          const author = (Array.isArray(row.author) ? row.author[0] : row.author) as
            | Record<string, unknown>
            | null;
          return {
            id: String(row.id),
            post_id: String(row.post_id),
            author_id: String(row.author_id),
            body: String(row.body ?? ''),
            parent_id: (row.parent_id as string | null) ?? null,
            created_at: String(row.created_at ?? ''),
            author_name: author ? String(author.name ?? 'CSE member') : 'CSE member',
            author_usn: author ? String(author.usn ?? '') : '',
            author_avatar: author ? ((author.avatar_url as string | null) ?? null) : null,
          };
        })
      );
    } else if (commentsResult.error) {
      logSupabaseError('Comments error', commentsResult.error);
    }

    if (userId) {
      const [likeRes, upvoteRes] = await Promise.all([
        supabase.from('likes').select('id').eq('post_id', id).eq('user_id', userId).maybeSingle(),
        supabase.from('upvotes').select('id').eq('post_id', id).eq('user_id', userId).maybeSingle(),
      ]);
      setLiked(Boolean(likeRes.data));
      setUpvoted(Boolean(upvoteRes.data));
    }

    setLoading(false);
  }, [id, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleLike = async () => {
    if (!post || !userId) return;
    const wasLiked = liked;
    setLiked(!wasLiked);
    setPost({ ...post, like_count: Math.max(0, (post.like_count ?? 0) + (wasLiked ? -1 : 1)) });
    const { error: writeError } = wasLiked
      ? await supabase.from('likes').delete().eq('post_id', post.id).eq('user_id', userId)
      : await supabase.from('likes').insert({ post_id: post.id, user_id: userId });
    if (writeError) {
      setLiked(wasLiked);
      setPost({ ...post });
      setActionError(writeError.message);
    }
  };

  const toggleUpvote = async () => {
    if (!post || !userId) return;
    const wasUpvoted = upvoted;
    setUpvoted(!wasUpvoted);
    setPost({ ...post, upvote_count: Math.max(0, (post.upvote_count ?? 0) + (wasUpvoted ? -1 : 1)) });
    const { error: writeError } = wasUpvoted
      ? await supabase.from('upvotes').delete().eq('post_id', post.id).eq('user_id', userId)
      : await supabase.from('upvotes').insert({ post_id: post.id, user_id: userId });
    if (writeError) {
      setUpvoted(wasUpvoted);
      setPost({ ...post });
      setActionError(writeError.message);
    }
  };

  const submitComment = async () => {
    if (!post || !userId || sending) return;
    const body = sanitizeText(draft, 2000);
    if (!body) return;
    setSending(true);
    setActionError(null);

    const { data, error: writeError } = await supabase
      .from('comments')
      .insert({ post_id: post.id, author_id: userId, body })
      .select('*')
      .single();

    if (writeError) {
      setActionError(writeError.message);
      setSending(false);
      return;
    }

    const created: Comment = {
      id: String(data.id),
      post_id: String(data.post_id),
      author_id: userId,
      body: String(data.body ?? body),
      parent_id: null,
      created_at: String(data.created_at ?? new Date().toISOString()),
      author_name: profile?.name ?? 'You',
      author_usn: profile?.usn ?? '',
      author_avatar: profile?.avatar_url ?? null,
    };

    setComments((previous) => [...previous, created]);
    setPost((previous) =>
      previous ? { ...previous, comment_count: (previous.comment_count ?? 0) + 1 } : previous
    );
    setDraft('');
    setSending(false);
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  };

  const openLink = (url: string) => {
    void Linking.openURL(url).catch(() => setActionError('That link could not be opened.'));
  };

  if (loading) {
    return (
      <Screen bottom>
        <BackHeader title="Post" />
        <View style={styles.loadingWrap}>
          <PostSkeleton />
        </View>
      </Screen>
    );
  }

  if (!post) {
    return (
      <Screen bottom>
        <BackHeader title="Post" />
        <ErrorState
          title="Post unavailable"
          message={error ?? 'This post could not be found.'}
          onRetry={load}
        />
      </Screen>
    );
  }

  const header = (
    <View>
      <View style={styles.typeRow}>
        <Badge
          label={post.type === 'showcase' ? 'Project showcase' : 'Discussion'}
          tone={post.type === 'showcase' ? 'warn' : 'accent'}
        />
        <Text style={styles.time}>{formatRelativeTime(post.created_at)}</Text>
      </View>

      <Text style={styles.title}>{post.title}</Text>

      <View style={styles.authorRow}>
        <Avatar name={post.author_name} uri={post.author_avatar} size={42} />
        <View style={styles.authorText}>
          <Text style={styles.authorName} numberOfLines={1}>
            {post.author_name}
          </Text>
          <Text style={styles.authorMeta} numberOfLines={1}>
            {[post.author_usn, getYearLabel(post.author_year)].filter(Boolean).join(' · ')}
          </Text>
        </View>
        {post.author_role && post.author_role !== 'student' ? (
          <Badge label={post.author_role} tone="accent" />
        ) : null}
      </View>

      <Text style={styles.body}>{post.body}</Text>

      {post.tech_stack.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Tech stack</Text>
          <View style={styles.chips}>
            {post.tech_stack.map((tech) => (
              <Chip key={tech} text={tech} tone="accent" />
            ))}
          </View>
        </View>
      ) : null}

      {post.tags.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Tags</Text>
          <View style={styles.chips}>
            {post.tags.map((tag) => (
              <Chip key={tag} text={`#${tag}`} />
            ))}
          </View>
        </View>
      ) : null}

      {post.github_url || post.demo_url ? (
        <View style={styles.links}>
          {post.github_url ? (
            <ActionButton label="GitHub" icon="logo-github" onPress={() => openLink(post.github_url!)} />
          ) : null}
          {post.demo_url ? (
            <ActionButton label="Live demo" icon="open-outline" onPress={() => openLink(post.demo_url!)} />
          ) : null}
        </View>
      ) : null}

      <View style={styles.engagement}>
        <Pressable
          onPress={() => void toggleLike()}
          accessibilityRole="button"
          accessibilityLabel={liked ? 'Unlike post' : 'Like post'}
          accessibilityState={{ selected: liked }}
          style={styles.metric}
        >
          <Ionicons name={liked ? 'heart' : 'heart-outline'} size={20} color={liked ? Brand.error : Brand.muted} />
          <Text style={[styles.metricText, liked && { color: Brand.error }]}>{post.like_count ?? 0}</Text>
        </Pressable>
        <Pressable
          onPress={() => void toggleUpvote()}
          accessibilityRole="button"
          accessibilityLabel={upvoted ? 'Remove upvote' : 'Upvote post'}
          accessibilityState={{ selected: upvoted }}
          style={styles.metric}
        >
          <Ionicons
            name={upvoted ? 'arrow-up-circle' : 'arrow-up-circle-outline'}
            size={21}
            color={upvoted ? Brand.accent : Brand.muted}
          />
          <Text style={[styles.metricText, upvoted && { color: Brand.accent }]}>{post.upvote_count ?? 0}</Text>
        </Pressable>
        <View style={styles.metric}>
          <Ionicons name="chatbubble-outline" size={18} color={Brand.muted} />
          <Text style={styles.metricText}>{comments.length}</Text>
        </View>
      </View>

      {actionError ? (
        <View style={styles.actionError}>
          <StatusBanner kind="error">{actionError}</StatusBanner>
        </View>
      ) : null}

      <View style={styles.commentsHeading}>
        <Text style={styles.commentsTitle}>Comments</Text>
        <Text style={styles.commentsCount}>{comments.length}</Text>
      </View>
    </View>
  );

  return (
    <Screen>
      <BackHeader title={post.type === 'showcase' ? 'Showcase' : 'Discussion'} subtitle={post.author_name} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.fill}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={listRef}
          data={comments}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <CommentRow comment={item} />}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <EmptyState
              icon="chatbubble-ellipses-outline"
              title="No comments yet"
              message="Add the first reply and get the conversation started."
            />
          }
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => {
            /* Keep the list anchored after the user sends a comment. */
          }}
        />

        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Write a comment…"
            placeholderTextColor={Brand.dim}
            style={styles.input}
            multiline
            maxLength={2000}
            selectionColor={Brand.accent}
            accessibilityLabel="Write a comment"
          />
          <Pressable
            onPress={() => void submitComment()}
            disabled={sending || draft.trim().length === 0}
            accessibilityRole="button"
            accessibilityLabel="Send comment"
            accessibilityState={{ disabled: sending || draft.trim().length === 0, busy: sending }}
            style={({ pressed }) => [
              styles.send,
              (sending || draft.trim().length === 0) && styles.sendDisabled,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="arrow-up" size={20} color={Brand.accentInk} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function CommentRow({ comment }: { comment: Comment }) {
  return (
    <View style={styles.commentRow}>
      <Avatar name={comment.author_name} uri={comment.author_avatar} size={32} />
      <View style={styles.commentBody}>
        <View style={styles.commentMeta}>
          <Text style={styles.commentName} numberOfLines={1}>
            {comment.author_name}
          </Text>
          <Text style={styles.commentTime}>{formatRelativeTime(comment.created_at)}</Text>
        </View>
        <Text style={styles.commentText}>{comment.body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  loadingWrap: {
    paddingHorizontal: 18,
    paddingTop: 8,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 18,
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  time: {
    fontFamily: Type.body,
    fontSize: 11.5,
    color: Brand.dim,
  },
  title: {
    fontFamily: Type.displayBold,
    fontSize: 26,
    lineHeight: 33,
    color: Brand.chromeInk,
    marginTop: 12,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    marginTop: 18,
  },
  authorText: {
    flex: 1,
    minWidth: 0,
  },
  authorName: {
    fontFamily: Type.bodySemiBold,
    fontSize: 13.5,
    color: Brand.ink,
  },
  authorMeta: {
    fontFamily: Type.body,
    fontSize: 11.5,
    color: Brand.dim,
    marginTop: 2,
  },
  body: {
    fontFamily: Type.body,
    fontSize: 14.5,
    lineHeight: 23,
    color: Brand.muted,
    marginTop: 18,
  },
  section: {
    marginTop: 18,
  },
  sectionLabel: {
    fontFamily: Type.bodySemiBold,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: Brand.dim,
    marginBottom: 8,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  links: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  engagement: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 22,
    marginTop: 20,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
  },
  metric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 32,
  },
  metricText: {
    fontFamily: Type.bodyMedium,
    fontSize: 12.5,
    color: Brand.muted,
  },
  actionError: {
    marginTop: 14,
  },
  commentsHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 24,
    marginBottom: 6,
  },
  commentsTitle: {
    fontFamily: Type.display,
    fontSize: 18,
    color: Brand.ink,
  },
  commentsCount: {
    fontFamily: Type.bodyMedium,
    fontSize: 11.5,
    color: Brand.dim,
    backgroundColor: Brand.elevated,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  commentRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Brand.line,
  },
  commentBody: {
    flex: 1,
    minWidth: 0,
  },
  commentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  commentName: {
    flex: 1,
    fontFamily: Type.bodySemiBold,
    fontSize: 12.5,
    color: Brand.ink,
  },
  commentTime: {
    fontFamily: Type.body,
    fontSize: 10.5,
    color: Brand.dim,
  },
  commentText: {
    fontFamily: Type.body,
    fontSize: 13,
    lineHeight: 19.5,
    color: Brand.muted,
    marginTop: 5,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 9,
    paddingHorizontal: 14,
    paddingTop: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Brand.line,
    backgroundColor: Brand.chrome,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 108,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    backgroundColor: Brand.elevated,
    paddingHorizontal: 15,
    paddingTop: 10,
    paddingBottom: 10,
    fontFamily: Type.body,
    fontSize: 14,
    lineHeight: 20,
    color: Brand.ink,
  },
  send: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Brand.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.7,
  },
});
