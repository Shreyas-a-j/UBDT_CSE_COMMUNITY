'use client';

/**
 * Authenticated Feed tab — real discussions and showcases from Supabase.
 *
 * The screen is a virtualized FlatList with server-side pagination. It does
 * not wrap the feed in a ScrollView, so long lists stay efficient and the
 * Android scroll indicator only appears for genuine overflow.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';

import { useAuth } from '@/lib/auth-context';
import { firstName } from '@/lib/profile';
import { Brand, Type } from '@/lib/theme';
import { FEED_PAGE_SIZE, usePagedPosts, type FeedFilter } from '@/lib/use-paged-posts';
import { Avatar } from '@/components/avatar';
import { Screen } from '@/components/layout';
import { PostCard } from '@/components/post-card';
import { FilterChips } from '@/components/segmented';
import { ListSkeleton } from '@/components/skeleton';
import { EmptyState, ErrorState, ListFooter } from '@/components/states';
import { Card, PrimaryButton, StatusBanner } from '@/components/ui';
import { Wordmark } from '@/components/wordmark';

const FILTERS: { value: FeedFilter; label: string }[] = [
  { value: 'all', label: 'All posts' },
  { value: 'discussion', label: 'Discussions' },
  { value: 'showcase', label: 'Showcases' },
];

export default function FeedScreen() {
  const { profile } = useAuth();
  const [filter, setFilter] = useState<FeedFilter>('all');
  const {
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
  } = usePagedPosts(filter);

  const refreshRef = useRef(refresh);
  const hasFocused = useRef(false);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  // Revalidate when returning from a detail/create screen, not on the first
  // focus (the initial fetch is already in flight).
  useFocusEffect(
    useCallback(() => {
      if (hasFocused.current) {
        refreshRef.current();
      } else {
        hasFocused.current = true;
      }
    }, [])
  );

  const openComposer = useCallback(() => {
    router.push('/create-post');
  }, []);

  const openProfile = useCallback(() => {
    router.navigate('/profile');
  }, []);

  const header = (
    <View>
      <View style={styles.brandRow}>
        <Wordmark size="small" />
        <Pressable
          onPress={openProfile}
          accessibilityRole="button"
          accessibilityLabel="Open your profile"
          hitSlop={8}
          style={({ pressed }) => [styles.profileButton, pressed && styles.pressed]}
        >
          <Avatar name={profile?.name} uri={profile?.avatar_url} size={36} />
        </Pressable>
      </View>

      <Text style={styles.eyebrow}>UBDT CSE · Community</Text>
      <Text style={styles.title} accessibilityRole="header">
        Community feed
      </Text>
      <Text style={styles.subtitle}>
        {profile ? `Welcome back, ${firstName(profile.name)}. ` : ''}
        Discussions, project showcases and updates from every batch.
      </Text>

      <Card style={styles.composer}>
        <Avatar name={profile?.name} uri={profile?.avatar_url} size={36} />
        <Pressable
          onPress={openComposer}
          accessibilityRole="button"
          accessibilityLabel="Create a new discussion or showcase"
          style={({ pressed }) => [styles.composerPrompt, pressed && styles.pressed]}
        >
          <Text style={styles.composerText} numberOfLines={1}>
            Share a question, project or idea…
          </Text>
        </Pressable>
        <Pressable
          onPress={openComposer}
          accessibilityRole="button"
          accessibilityLabel="New post"
          style={({ pressed }) => [styles.composerAction, pressed && styles.pressed]}
        >
          <Ionicons name="add" size={21} color={Brand.accentInk} />
        </Pressable>
      </Card>

      <View style={styles.filters}>
        <FilterChips
          options={FILTERS}
          value={filter}
          onChange={setFilter}
          accessibilityLabel="Filter the community feed"
        />
      </View>

      {error && posts.length > 0 ? (
        <View style={styles.inlineError}>
          <StatusBanner kind="warning">{error}</StatusBanner>
          <Pressable onPress={retry} accessibilityRole="button" style={styles.retryLink}>
            <Ionicons name="refresh" size={13} color={Brand.accent} />
            <Text style={styles.retryLinkText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  const empty = loading ? (
    <ListSkeleton count={4} />
  ) : error ? (
    <ErrorState
      title="The feed is unavailable"
      message={error}
      onRetry={retry}
      retrying={loading}
    />
  ) : filter === 'discussion' ? (
    <EmptyState
      icon="chatbubbles-outline"
      title="No discussions yet"
      message="Ask the department a question or share something useful. The first discussion starts here."
      action={<PrimaryButton label="Start a discussion" onPress={openComposer} icon="add" />}
    />
  ) : filter === 'showcase' ? (
    <EmptyState
      icon="sparkles-outline"
      title="No showcases yet"
      message="Built something? Share the project, the stack and what you learned with the community."
      action={<PrimaryButton label="Share a project" onPress={openComposer} icon="add" />}
    />
  ) : (
    <EmptyState
      icon="people-outline"
      title="The community is quiet"
      message="No posts have been published yet. Start the first discussion or show off a project."
      action={<PrimaryButton label="Create the first post" onPress={openComposer} icon="add" />}
    />
  );

  return (
    <Screen>
      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <PostCard
            post={item}
            liked={likedIds.has(item.id)}
            upvoted={upvotedIds.has(item.id)}
            onPress={() => router.push({ pathname: '/post/[id]', params: { id: item.id } })}
            onToggleLike={() => void toggleLike(item.id)}
            onToggleUpvote={() => void toggleUpvote(item.id)}
          />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={
          posts.length > 0 ? (
            <>
              <ListFooter visible={loadingMore} />
              {!hasMore && !loadingMore ? (
                <Text style={styles.endNote}>
                  {posts.length < FEED_PAGE_SIZE ? 'You’re all caught up' : 'End of feed'}
                </Text>
              ) : null}
            </>
          ) : undefined
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={Brand.accent}
            colors={[Brand.accent]}
            progressBackgroundColor={Brand.surface}
          />
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.45}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={5}
        maxToRenderPerBatch={6}
        windowSize={7}
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 30,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  profileButton: {
    borderRadius: 20,
  },
  pressed: {
    opacity: 0.65,
  },
  eyebrow: {
    fontFamily: Type.bodySemiBold,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: Brand.accent,
    marginBottom: 6,
  },
  title: {
    fontFamily: Type.displayBold,
    fontSize: 30,
    lineHeight: 36,
    color: Brand.chromeInk,
  },
  subtitle: {
    fontFamily: Type.body,
    fontSize: 13,
    lineHeight: 19,
    color: Brand.dim,
    marginTop: 6,
    marginBottom: 18,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 12,
  },
  composerPrompt: {
    flex: 1,
    minWidth: 0,
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    backgroundColor: Brand.elevated,
  },
  composerText: {
    fontFamily: Type.body,
    fontSize: 12.5,
    color: Brand.dim,
  },
  composerAction: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: Brand.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filters: {
    marginHorizontal: -18,
    marginTop: 16,
    marginBottom: 14,
  },
  inlineError: {
    marginBottom: 12,
  },
  retryLink: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 4,
    marginTop: 6,
    minHeight: 32,
  },
  retryLinkText: {
    fontFamily: Type.bodyMedium,
    fontSize: 12,
    color: Brand.accent,
  },
  separator: {
    height: 12,
  },
  endNote: {
    fontFamily: Type.body,
    fontSize: 11.5,
    color: Brand.dim,
    textAlign: 'center',
    paddingVertical: 20,
  },
});
