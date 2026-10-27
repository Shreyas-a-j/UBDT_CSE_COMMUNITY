'use client';

/**
 * Post detail — full discussion/showcase content, real engagement actions,
 * inline editing/deletion for the author, faculty pinning, native sharing and
 * the threaded comment list. Comments and the composer share a
 * KeyboardAvoiding layout that keeps the input above the Android keyboard.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { TextInputInstance } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import {
  COMMENT_SELECT,
  PIN_SELECT,
  POST_SELECT,
  formatRelativeTime,
  getYearLabel,
  mapComment,
  mapPost,
  sanitizeText,
} from '@/lib/community';
import { pinErrorMessage } from '@/lib/feed-logic';
import { KEYBOARD_AVOIDING_BEHAVIOR } from '@/lib/keyboard';
import { alumniTag, canManageDiscussionPins, resolveMemberType } from '@/lib/profile';
import { logSupabaseError } from '@/lib/errors';
import { Brand, Radius, Type } from '@/lib/theme';
import type { Comment, Post } from '@/lib/types';
import { Avatar } from '@/components/avatar';
import { Badge } from '@/components/badge';
import { LinkifiedText } from '@/components/linkified-text';
import { Screen, BackHeader } from '@/components/layout';
import { PostSkeleton } from '@/components/skeleton';
import { EmptyState, ErrorState } from '@/components/states';
import { ActionButton, Chip, StatusBanner } from '@/components/ui';

interface ThreadedComment {
  comment: Comment;
  depth: number;
}

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
  const [pinned, setPinned] = useState(false);
  const [pinExpiresAt, setPinExpiresAt] = useState<string | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [saving, setSaving] = useState(false);
  const listRef = useRef<FlatList<ThreadedComment>>(null);
  const inputRef = useRef<TextInputInstance>(null);

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

    const mapped = mapPost(postResult.data as Record<string, unknown>);
    setPost(mapped);

    /* ------------------------------- comments ------------------------------ */
    let commentsResult = await supabase
      .from('comments')
      .select(COMMENT_SELECT)
      .eq('post_id', id)
      .order('created_at', { ascending: true })
      .limit(200);

    if (commentsResult.error) {
      commentsResult = await supabase
        .from('comments')
        .select('*')
        .eq('post_id', id)
        .order('created_at', { ascending: true })
        .limit(200);
    }

    if (!commentsResult.error && commentsResult.data) {
      setComments(
        (commentsResult.data as unknown as Record<string, unknown>[]).map(mapComment)
      );
    } else if (commentsResult.error) {
      logSupabaseError('Comments error', commentsResult.error);
    }

    /* ------------------------------ viewer state --------------------------- */
    if (userId) {
      const [likeRes, upvoteRes] = await Promise.all([
        supabase.from('likes').select('id').eq('post_id', id).eq('user_id', userId).maybeSingle(),
        supabase.from('upvotes').select('id').eq('post_id', id).eq('user_id', userId).maybeSingle(),
      ]);
      setLiked(Boolean(likeRes.data));
      setUpvoted(Boolean(upvoteRes.data));
    }

    const pinRes = await supabase
      .from('discussion_pins')
      .select(PIN_SELECT)
      .eq('post_id', id)
      .is('unpinned_at', null)
      .gt('pin_expires_at', new Date().toISOString())
      .maybeSingle();
    if (!pinRes.error) {
      setPinned(Boolean(pinRes.data));
      setPinExpiresAt(
        pinRes.data ? String((pinRes.data as Record<string, unknown>).pin_expires_at ?? '') : null
      );
    } else {
      setPinned(false);
      setPinExpiresAt(null);
    }

    setLoading(false);
  }, [id, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const threaded = useMemo<ThreadedComment[]>(() => {
    const ids = new Set(comments.map((comment) => comment.id));
    const byParent = new Map<string, Comment[]>();
    const roots: Comment[] = [];

    for (const comment of comments) {
      if (comment.parent_id && ids.has(comment.parent_id)) {
        const list = byParent.get(comment.parent_id) ?? [];
        list.push(comment);
        byParent.set(comment.parent_id, list);
      } else {
        roots.push(comment);
      }
    }

    const out: ThreadedComment[] = [];
    const walk = (comment: Comment, depth: number) => {
      out.push({ comment, depth: Math.min(depth, 4) });
      for (const child of byParent.get(comment.id) ?? []) walk(child, depth + 1);
    };
    for (const root of roots) walk(root, 0);
    return out;
  }, [comments]);

  const toggleLike = async () => {
    if (!post || !userId) return;
    const wasLiked = liked;
    setLiked(!wasLiked);
    setPost({
      ...post,
      like_count: Math.max(0, (post.like_count ?? 0) + (wasLiked ? -1 : 1)),
    });
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
    setPost({
      ...post,
      upvote_count: Math.max(0, (post.upvote_count ?? 0) + (wasUpvoted ? -1 : 1)),
    });
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
      .insert({
        post_id: post.id,
        author_id: userId,
        body,
        parent_id: replyTo?.id ?? null,
      })
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
      parent_id: (data.parent_id as string | null) ?? replyTo?.id ?? null,
      created_at: String(data.created_at ?? new Date().toISOString()),
      author_name: profile?.name ?? 'You',
      author_usn: profile?.usn ?? '',
      author_avatar: profile?.avatar_url ?? null,
      author_member_type: profile?.member_type ?? 'student',
      author_graduation_year: profile?.graduation_year ?? null,
    };

    setComments((previous) => [...previous, created]);
    setPost((previous) =>
      previous ? { ...previous, comment_count: (previous.comment_count ?? 0) + 1 } : previous
    );
    setDraft('');
    setReplyTo(null);
    setSending(false);
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  };

  const beginReply = (comment: Comment) => {
    setReplyTo(comment);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const startEdit = () => {
    if (!post) return;
    setEditTitle(post.title);
    setEditBody(post.body);
    setEditing(true);
    setActionError(null);
  };

  const saveEdit = async () => {
    if (!post || saving) return;
    const cleanTitle = sanitizeText(editTitle, 200);
    const cleanBody = sanitizeText(editBody, 8000);
    if (cleanTitle.length < 3) {
      setActionError('Give your post a title of at least 3 characters.');
      return;
    }
    if (cleanBody.length < 10) {
      setActionError('Add at least 10 characters of detail so people can respond.');
      return;
    }

    setSaving(true);
    const { error: writeError } = await supabase
      .from('posts')
      .update({ title: cleanTitle, body: cleanBody })
      .eq('id', post.id);
    setSaving(false);

    if (writeError) {
      setActionError(writeError.message);
      return;
    }
    setPost({ ...post, title: cleanTitle, body: cleanBody });
    setEditing(false);
  };

  const confirmDelete = () => {
    if (!post) return;
    Alert.alert('Delete post', `Delete “${post.title}”? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const { data, error: deleteError } = await supabase
            .from('posts')
            .delete()
            .eq('id', post.id)
            .select('id');
          if (deleteError) {
            setActionError(deleteError.message);
            return;
          }
          if (!data || data.length === 0) {
            setActionError(
              'The post could not be deleted. It may already be gone, or you may not have permission.'
            );
            return;
          }
          router.back();
        },
      },
    ]);
  };

  const togglePin = async () => {
    if (!post || pinBusy) return;
    setPinBusy(true);
    setActionError(null);
    const { error: rpcError } = await supabase.rpc(
      pinned ? 'unpin_discussion' : 'pin_discussion',
      { p_discussion_id: post.id }
    );
    setPinBusy(false);
    if (rpcError) {
      setActionError(pinErrorMessage(rpcError.message));
      return;
    }
    setPinned((previous) => !previous);
    setPinExpiresAt(null);
  };

  const sharePost = async () => {
    if (!post) return;
    try {
      await Share.share({
        message: `${post.title}\n\n${post.body}\n\nUCC CSE community`,
        title: post.title,
      });
    } catch {
      setActionError('The share sheet could not be opened.');
    }
  };

  const openLink = (url: string) => {
    void import('react-native').then(({ Linking }) =>
      Linking.openURL(url).catch(() => setActionError('That link could not be opened.'))
    );
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

  const isAuthor = post.author_id === userId;
  const canPin = post.type === 'discussion' && canManageDiscussionPins(profile);
  const isShowcase = post.type === 'showcase';

  const header = (
    <View>
      <View style={styles.typeRow}>
        <Badge
          label={isShowcase ? 'Project showcase' : 'Discussion'}
          tone={isShowcase ? 'warn' : 'accent'}
        />
        <Text style={styles.time}>{formatRelativeTime(post.created_at)}</Text>
      </View>

      {editing ? (
        <View style={styles.editor}>
          <Text style={styles.editorLabel}>Title</Text>
          <TextInput
            value={editTitle}
            onChangeText={setEditTitle}
            style={styles.editorTitle}
            maxLength={200}
            selectionColor={Brand.accent}
            accessibilityLabel="Edit post title"
          />
          <Text style={styles.editorLabel}>Body</Text>
          <TextInput
            value={editBody}
            onChangeText={setEditBody}
            style={styles.editorBody}
            multiline
            maxLength={8000}
            selectionColor={Brand.accent}
            accessibilityLabel="Edit post body"
          />
          <View style={styles.editorActions}>
            <ActionButton
              label={saving ? 'Saving…' : 'Save'}
              icon="save-outline"
              tone="accent"
              onPress={() => void saveEdit()}
              disabled={saving}
            />
            <ActionButton label="Cancel" icon="close-outline" onPress={() => setEditing(false)} />
          </View>
        </View>
      ) : (
        <>
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
            {resolveMemberType(post.author_member_type, post.author_role) === 'alumni' ? (
              <Badge label={alumniTag(post.author_graduation_year)} tone="warn" />
            ) : null}
          </View>

          {pinned ? (
            <View style={styles.pinBanner}>
              <Ionicons name="pin" size={13} color={Brand.accent} />
              <Text style={styles.pinBannerText}>
                Pinned by faculty
                {pinExpiresAt
                  ? ` · expires ${new Date(pinExpiresAt).toLocaleDateString()}`
                  : ''}
              </Text>
            </View>
          ) : null}

          <LinkifiedText text={post.body} style={styles.body} />

          {post.image_url ? (
            <Image
              source={{ uri: post.image_url }}
              style={styles.image}
              resizeMode="cover"
              accessibilityLabel={`Image attached to ${post.title}`}
            />
          ) : null}

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
                <ActionButton
                  label="GitHub"
                  icon="logo-github"
                  onPress={() => openLink(post.github_url!)}
                />
              ) : null}
              {post.demo_url ? (
                <ActionButton
                  label="Live demo"
                  icon="open-outline"
                  onPress={() => openLink(post.demo_url!)}
                />
              ) : null}
            </View>
          ) : null}

          <View style={styles.engagement}>
            {isShowcase ? (
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
                  color={upvoted ? Brand.warning : Brand.muted}
                />
                <Text style={[styles.metricText, upvoted && { color: Brand.warning }]}>
                  {post.upvote_count ?? 0}
                </Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => void toggleLike()}
                accessibilityRole="button"
                accessibilityLabel={liked ? 'Unlike post' : 'Like post'}
                accessibilityState={{ selected: liked }}
                style={styles.metric}
              >
                <Ionicons
                  name={liked ? 'heart' : 'heart-outline'}
                  size={20}
                  color={liked ? Brand.error : Brand.muted}
                />
                <Text style={[styles.metricText, liked && { color: Brand.error }]}>
                  {post.like_count ?? 0}
                </Text>
              </Pressable>
            )}
            <View style={styles.metric}>
              <Ionicons name="chatbubble-outline" size={18} color={Brand.muted} />
              <Text style={styles.metricText}>{comments.length}</Text>
            </View>
            <Pressable
              onPress={() => void sharePost()}
              accessibilityRole="button"
              accessibilityLabel="Share post"
              style={styles.metric}
            >
              <Ionicons name="share-social-outline" size={18} color={Brand.muted} />
              <Text style={styles.metricText}>Share</Text>
            </Pressable>
          </View>

          {isAuthor || canPin ? (
            <View style={styles.ownerActions}>
              {isAuthor ? (
                <ActionButton label="Edit" icon="create-outline" onPress={startEdit} />
              ) : null}
              {isAuthor ? (
                <ActionButton
                  label="Delete"
                  icon="trash-outline"
                  tone="danger"
                  onPress={confirmDelete}
                />
              ) : null}
              {canPin ? (
                <ActionButton
                  label={
                    pinBusy
                      ? 'Updating…'
                      : pinned
                        ? 'Unpin'
                        : 'Pin for 7 days'
                  }
                  icon={pinned ? 'pin-outline' : 'pin'}
                  tone="accent"
                  onPress={() => void togglePin()}
                  disabled={pinBusy}
                />
              ) : null}
            </View>
          ) : null}
        </>
      )}

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
      <BackHeader
        title={post.type === 'showcase' ? 'Showcase' : 'Discussion'}
        subtitle={post.author_name}
      />
      <KeyboardAvoidingView
        behavior={KEYBOARD_AVOIDING_BEHAVIOR}
        style={styles.fill}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={listRef}
          data={threaded}
          keyExtractor={(item) => item.comment.id}
          renderItem={({ item }) => (
            <CommentRow
              comment={item.comment}
              depth={item.depth}
              onReply={() => beginReply(item.comment)}
            />
          )}
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
        />

        <View style={[styles.composerWrap, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          {replyTo ? (
            <View style={styles.replyBar}>
              <Ionicons name="return-down-forward" size={13} color={Brand.accent} />
              <Text style={styles.replyBarText} numberOfLines={1}>
                Replying to {replyTo.author_name}
              </Text>
              <Pressable
                onPress={() => setReplyTo(null)}
                accessibilityRole="button"
                accessibilityLabel="Cancel reply"
                hitSlop={8}
              >
                <Ionicons name="close" size={15} color={Brand.dim} />
              </Pressable>
            </View>
          ) : null}
          <View style={styles.composer}>
            <TextInput
              ref={inputRef}
              value={draft}
              onChangeText={setDraft}
              placeholder={replyTo ? `Reply to ${replyTo.author_name}…` : 'Write a comment…'}
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
              accessibilityState={{
                disabled: sending || draft.trim().length === 0,
                busy: sending,
              }}
              style={({ pressed }) => [
                styles.send,
                (sending || draft.trim().length === 0) && styles.sendDisabled,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="arrow-up" size={20} color={Brand.accentInk} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function CommentRow({
  comment,
  depth,
  onReply,
}: {
  comment: Comment;
  depth: number;
  onReply: () => void;
}) {
  return (
    <View style={[styles.commentRow, depth > 0 && { marginLeft: Math.min(depth, 4) * 18 }]}>
      <Avatar name={comment.author_name} uri={comment.author_avatar} size={30} />
      <View style={styles.commentBody}>
        <View style={styles.commentMeta}>
          <Text style={styles.commentName} numberOfLines={1}>
            {comment.author_name}
          </Text>
          {comment.author_member_type === 'alumni' ? (
            <Badge label={alumniTag(comment.author_graduation_year)} tone="warn" />
          ) : null}
          <Text style={styles.commentTime}>{formatRelativeTime(comment.created_at)}</Text>
        </View>
        <LinkifiedText text={comment.body} style={styles.commentText} />
        <Pressable
          onPress={onReply}
          accessibilityRole="button"
          accessibilityLabel={`Reply to ${comment.author_name}`}
          hitSlop={6}
          style={styles.replyLink}
        >
          <Ionicons name="return-down-forward-outline" size={12} color={Brand.dim} />
          <Text style={styles.replyLinkText}>Reply</Text>
        </Pressable>
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
  pinBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${Brand.accent}55`,
    backgroundColor: Brand.accentSoft,
  },
  pinBannerText: {
    fontFamily: Type.bodyMedium,
    fontSize: 11.5,
    color: Brand.accent,
  },
  body: {
    fontFamily: Type.body,
    fontSize: 14.5,
    lineHeight: 23,
    color: Brand.muted,
    marginTop: 18,
  },
  image: {
    width: '100%',
    height: 220,
    borderRadius: 11,
    marginTop: 14,
    backgroundColor: Brand.elevated,
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
    flexWrap: 'wrap',
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
  ownerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  editor: {
    marginTop: 14,
    gap: 8,
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    backgroundColor: Brand.surface,
  },
  editorLabel: {
    fontFamily: Type.bodySemiBold,
    fontSize: 10.5,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: Brand.dim,
  },
  editorTitle: {
    minHeight: 42,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    backgroundColor: Brand.elevated,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontFamily: Type.display,
    fontSize: 17,
    color: Brand.ink,
  },
  editorBody: {
    minHeight: 140,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    backgroundColor: Brand.elevated,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: Type.body,
    fontSize: 13.5,
    lineHeight: 20,
    color: Brand.ink,
    textAlignVertical: 'top',
  },
  editorActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
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
    overflow: 'hidden',
  },
  commentRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 12,
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
  replyLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    minHeight: 30,
    marginTop: 2,
  },
  replyLinkText: {
    fontFamily: Type.bodyMedium,
    fontSize: 10.5,
    color: Brand.dim,
  },
  composerWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Brand.line,
    backgroundColor: Brand.chrome,
    paddingTop: 7,
  },
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  replyBarText: {
    flex: 1,
    fontFamily: Type.body,
    fontSize: 11,
    color: Brand.muted,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 9,
    paddingHorizontal: 14,
    paddingTop: 2,
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
