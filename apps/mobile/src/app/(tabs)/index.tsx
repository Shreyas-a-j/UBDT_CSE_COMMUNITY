'use client';

/**
 * Community feed — parity with the website's home page.
 *
 * Sections follow the website's selection rules (`lib/feed-logic.ts`):
 *   Popular (up to two upvoted showcases) → Announcements → Latest posts
 *   → Upcoming events, plus the pinned-discussion rail.
 *
 * Tabs, batch, search and the pinned rail all use the same pure helpers as the
 * web so the two surfaces can never disagree about what belongs where.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';

import { useAuth } from '@/lib/auth-context';
import { firstName, canManageDiscussionPins } from '@/lib/profile';
import { Brand, Radius, Type } from '@/lib/theme';
import type { Announcement, Event, FeedFilter, Post } from '@/lib/types';
import {
  MAX_ACTIVE_DISCUSSION_PINS,
  PIN_SLOTS_FULL_MESSAGE,
  filterFeedAnnouncements,
  filterFeedEvents,
  filterFeedPosts,
  filterActiveEvents,
  normalizeBatch,
  rankPopularShowcases,
  type BatchFilter,
} from '@/lib/feed-logic';
import { useCommunityFeed } from '@/lib/use-community-feed';
import { Avatar } from '@/components/avatar';
import { Screen } from '@/components/layout';
import { PostCard } from '@/components/post-card';
import { AnnouncementCard } from '@/components/announcement-card';
import { EventCard } from '@/components/event-card';
import { FilterChips } from '@/components/segmented';
import { SectionHeader, InlineAction } from '@/components/section-header';
import { ListSkeleton } from '@/components/skeleton';
import { EmptyState, ErrorState } from '@/components/states';
import { GhostButton, PrimaryButton, StatusBanner, type IconName } from '@/components/ui';
import { Wordmark } from '@/components/wordmark';

const FILTERS: { value: FeedFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'discussions', label: 'Discussions' },
  { value: 'showcases', label: 'Showcases' },
  { value: 'events', label: 'Events' },
  { value: 'announcements', label: 'Announcements' },
];

const BATCHES: { value: string; label: string }[] = [
  { value: '0', label: 'All batches' },
  { value: '1', label: '1st year' },
  { value: '2', label: '2nd year' },
  { value: '3', label: '3rd year' },
  { value: '4', label: '4th year' },
];

type FeedRow =
  | {
      kind: 'section';
      key: string;
      title: string;
      count: number;
      icon: IconName;
      action?: 'announcements';
    }
  | { kind: 'post'; key: string; post: Post; pinned?: boolean; isPopular?: boolean }
  | { kind: 'announcement'; key: string; announcement: Announcement }
  | { kind: 'event'; key: string; event: Event };

export default function FeedScreen() {
  const { profile, session } = useAuth();
  const userId = session?.user.id ?? null;

  const [filter, setFilter] = useState<FeedFilter>('all');
  const [batch, setBatch] = useState<BatchFilter>(0);
  const [query, setQuery] = useState('');
  const [actionDismissed, setActionDismissed] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const {
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
  } = useCommunityFeed();

  const selection = useMemo(
    () => ({ feedFilter: filter, batch, searchQuery: query }),
    [filter, batch, query]
  );

  const showPinned =
    (filter === 'all' || filter === 'discussions') && query.trim().length === 0;

  const pinnedIdSet = useMemo(() => new Set(pinnedPosts.map((post) => post.id)), [pinnedPosts]);

  const filteredPosts = useMemo(() => {
    const matched = filterFeedPosts(posts, selection);
    if (!showPinned) return matched;
    return matched.filter((post) => !pinnedIdSet.has(post.id));
  }, [posts, selection, showPinned, pinnedIdSet]);

  const popularShowcases = useMemo(() => rankPopularShowcases(filteredPosts), [filteredPosts]);
  const popularIds = useMemo(
    () => new Set(popularShowcases.map((post) => post.id)),
    [popularShowcases]
  );

  const filteredEvents = useMemo(
    () => filterFeedEvents(events, selection, now),
    [events, selection, now]
  );
  const filteredAnnouncements = useMemo(
    () => filterFeedAnnouncements(announcements, selection),
    [announcements, selection]
  );

  const activeEvents = useMemo(() => filterActiveEvents(events, now), [events, now]);

  const counts = useMemo(
    () => ({
      all: posts.length + activeEvents.length + announcements.length,
      discussions: posts.filter((post) => post.type === 'discussion').length,
      showcases: posts.filter((post) => post.type === 'showcase').length,
      events: activeEvents.length,
      announcements: announcements.length,
    }),
    [posts, activeEvents, announcements]
  );

  const showPosts = filter !== 'events' && filter !== 'announcements';
  const showEvents = filter === 'all' || filter === 'events';
  const showAnnouncements = filter === 'all' || filter === 'announcements';

  const rows = useMemo<FeedRow[]>(() => {
    const next: FeedRow[] = [];

    if (showPosts && popularShowcases.length > 0) {
      next.push({
        kind: 'section',
        key: 'section-popular',
        title: 'Popular',
        count: popularShowcases.length,
        icon: 'trending-up-outline',
      });
      for (const post of popularShowcases) {
        next.push({ kind: 'post', key: `popular-${post.id}`, post, isPopular: true });
      }
    }

    if (showAnnouncements && filteredAnnouncements.length > 0) {
      next.push({
        kind: 'section',
        key: 'section-announcements',
        title: 'Announcements',
        count: filteredAnnouncements.length,
        icon: 'megaphone-outline',
        action: 'announcements',
      });
      for (const announcement of filteredAnnouncements) {
        next.push({
          kind: 'announcement',
          key: `announcement-${announcement.id}`,
          announcement,
        });
      }
    }

    if (showPosts && filteredPosts.length > 0) {
      next.push({
        kind: 'section',
        key: 'section-posts',
        title:
          filter === 'showcases'
            ? 'Project showcase'
            : filter === 'discussions'
              ? 'Discussions'
              : 'Latest posts',
        count: filteredPosts.length,
        icon: filter === 'showcases' ? 'sparkles-outline' : 'chatbubbles-outline',
      });
      for (const post of filteredPosts) {
        next.push({
          kind: 'post',
          key: `post-${post.id}`,
          post,
          isPopular: popularIds.has(post.id),
        });
      }
    }

    if (showEvents && filteredEvents.length > 0) {
      next.push({
        kind: 'section',
        key: 'section-events',
        title: 'Upcoming events',
        count: filteredEvents.length,
        icon: 'calendar-outline',
      });
      for (const event of filteredEvents) {
        next.push({ kind: 'event', key: `event-${event.id}`, event });
      }
    }

    return next;
  }, [
    showPosts,
    popularShowcases,
    popularIds,
    showAnnouncements,
    filteredAnnouncements,
    showEvents,
    filteredEvents,
    filteredPosts,
    filter,
  ]);

  const totalItemCount =
    (showPosts ? filteredPosts.length : 0) +
    (showEvents ? filteredEvents.length : 0) +
    (showAnnouncements ? filteredAnnouncements.length : 0);

  const refreshRef = useRef(refresh);
  const hasFocused = useRef(false);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      if (hasFocused.current) refreshRef.current();
      else hasFocused.current = true;
    }, [])
  );

  const showActionError = Boolean(actionError) && !actionDismissed;
  useEffect(() => {
    if (actionError) setActionDismissed(false);
  }, [actionError]);

  const openComposer = useCallback(() => router.push('/create-post'), []);
  const openEventComposer = useCallback(() => router.push('/create-event'), []);

  const header = (
    <View>
      <View style={styles.brandRow}>
        <Wordmark size="small" />
        <Pressable
          onPress={() => router.navigate('/profile')}
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
        Discussions, project showcases and workshops from every CSE batch.
      </Text>

      <View style={styles.composer}>
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
      </View>

      <View style={styles.composerActions}>
        <View style={styles.composerAction}>
          <PrimaryButton label="New post" icon="add" onPress={openComposer} />
        </View>
        <View style={styles.composerAction}>
          <GhostButton label="Host event" icon="calendar-outline" onPress={openEventComposer} />
        </View>
      </View>

      <View style={styles.filters}>
        <FilterChips
          options={FILTERS.map((item) => ({
            ...item,
            count:
              item.value === 'all'
                ? counts.all
                : item.value === 'discussions'
                  ? counts.discussions
                  : item.value === 'showcases'
                    ? counts.showcases
                    : item.value === 'events'
                      ? counts.events
                      : counts.announcements,
          }))}
          value={filter}
          onChange={setFilter}
          accessibilityLabel="Filter the community feed"
        />
      </View>

      <View style={styles.batchRow}>
        <Text style={styles.batchLabel}>Batch</Text>
        <View style={styles.batchChips}>
          <FilterChips
            options={BATCHES}
            value={String(batch)}
            onChange={(value) => setBatch(normalizeBatch(value))}
            accessibilityLabel="Filter by batch"
          />
        </View>
      </View>

      <View style={styles.search}>
        <Ionicons name="search" size={16} color={Brand.dim} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search posts, projects and events…"
          placeholderTextColor={Brand.dim}
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search the feed"
        />
        {query ? (
          <Pressable
            onPress={() => setQuery('')}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={8}
          >
            <Ionicons name="close-circle" size={18} color={Brand.dim} />
          </Pressable>
        ) : null}
      </View>

      {query.trim() ? (
        <View style={styles.searchSummary}>
          <Text style={styles.searchSummaryText}>
            {totalItemCount} result{totalItemCount === 1 ? '' : 's'} for{' '}
            <Text style={styles.searchSummaryQuery}>“{query.trim()}”</Text>
          </Text>
          <Pressable onPress={() => setQuery('')} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.clearText}>Clear</Text>
          </Pressable>
        </View>
      ) : null}

      {error ? (
        <View style={styles.banner}>
          <StatusBanner kind="warning">
            Some feed data could not be refreshed. {error}
          </StatusBanner>
        </View>
      ) : null}

      {showActionError ? (
        <Pressable
          style={styles.banner}
          onPress={() => {
            clearActionError();
            setActionDismissed(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Dismiss error"
        >
          <StatusBanner kind="error">{actionError}</StatusBanner>
        </Pressable>
      ) : null}

      {!loading && showPinned && pinnedPosts.length > 0 ? (
        <View style={styles.pinnedSection}>
          <SectionHeader
            title="Pinned"
            count={pinnedPosts.length}
            icon="pin-outline"
            action={<Text style={styles.pinnedHint}>7-day faculty pins</Text>}
          />
          {pinnedPosts.length >= MAX_ACTIVE_DISCUSSION_PINS &&
          canManageDiscussionPins(profile) ? (
            <Text style={styles.slotNotice}>{PIN_SLOTS_FULL_MESSAGE}</Text>
          ) : null}
          <View style={styles.pinnedList}>
            {pinnedPosts.map((post) => (
              <PostCard
                key={`pinned-${post.id}`}
                post={post}
                pinned
                liked={likedIds.has(post.id)}
                upvoted={upvotedIds.has(post.id)}
                pinBusy={pinBusyIds.has(post.id)}
                pinLimitReached={pinnedPosts.length >= MAX_ACTIVE_DISCUSSION_PINS}
                onPinExpired={() => void refreshPins()}
                onTogglePin={() => void togglePin(post.id)}
                onPress={() => router.push({ pathname: '/post/[id]', params: { id: post.id } })}
                onToggleLike={() => void toggleLike(post.id)}
                onToggleUpvote={() => void toggleUpvote(post.id)}
              />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );

  const empty = loading ? (
    <ListSkeleton count={4} />
  ) : error ? (
    <ErrorState title="The feed is unavailable" message={error} onRetry={retry} retrying={loading} />
  ) : query.trim() ? (
    <EmptyState
      icon="search-outline"
      title="Nothing matched that search"
      message={`No posts, projects or events matched “${query.trim()}”. Try a different keyword or clear the filters.`}
      action={<GhostButton label="Clear search" onPress={() => setQuery('')} />}
    />
  ) : filter === 'events' ? (
    <EmptyState
      icon="calendar-outline"
      title="No upcoming events yet"
      message="Workshops, reviews and meetups will appear here once they are scheduled."
      action={<PrimaryButton label="Host an event" icon="add" onPress={openEventComposer} />}
    />
  ) : filter === 'announcements' ? (
    <EmptyState
      icon="megaphone-outline"
      title="No announcements yet"
      message="Faculty announcements will appear here when they are published."
    />
  ) : filter === 'discussions' ? (
    <EmptyState
      icon="chatbubbles-outline"
      title="No discussions yet"
      message="Ask the department a question or share something useful. The first discussion starts here."
      action={<PrimaryButton label="Start a discussion" onPress={openComposer} icon="add" />}
    />
  ) : filter === 'showcases' ? (
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
      message="Start the first discussion, share a project, or schedule something for your batch."
      action={<PrimaryButton label="Create a post" onPress={openComposer} icon="add" />}
    />
  );

  return (
    <Screen>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => {
          if (item.kind === 'section') {
            return (
              <View style={styles.sectionHeader}>
                <SectionHeader
                  title={item.title}
                  count={item.count}
                  icon={item.icon}
                  action={
                    item.action === 'announcements' ? (
                      <InlineAction
                        label="Open channel"
                        icon="arrow-forward"
                        onPress={() => router.push('/announcements')}
                      />
                    ) : undefined
                  }
                />
              </View>
            );
          }

          if (item.kind === 'post') {
            return (
              <PostCard
                post={item.post}
                pinned={Boolean(item.pinned)}
                isPopular={Boolean(item.isPopular)}
                liked={likedIds.has(item.post.id)}
                upvoted={upvotedIds.has(item.post.id)}
                pinBusy={pinBusyIds.has(item.post.id)}
                pinLimitReached={pinnedPosts.length >= MAX_ACTIVE_DISCUSSION_PINS}
                onPinExpired={() => void refreshPins()}
                onTogglePin={
                  item.post.type === 'discussion' && canManageDiscussionPins(profile)
                    ? () => void togglePin(item.post.id)
                    : undefined
                }
                onPress={() =>
                  router.push({ pathname: '/post/[id]', params: { id: item.post.id } })
                }
                onToggleLike={() => void toggleLike(item.post.id)}
                onToggleUpvote={() => void toggleUpvote(item.post.id)}
              />
            );
          }

          if (item.kind === 'announcement') {
            return (
              <AnnouncementCard
                announcement={item.announcement}
                viewerId={userId}
                onToggleReaction={(reaction) =>
                  void toggleAnnouncementReaction(item.announcement.id, reaction)
                }
              />
            );
          }

          return (
            <EventCard
              event={item.event}
              going={rsvpIds.has(item.event.id)}
              onToggleRsvp={() => void toggleRsvp(item.event)}
              onPress={() =>
                router.push({ pathname: '/event/[id]', params: { id: item.event.id } })
              }
            />
          );
        }}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
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
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={6}
        maxToRenderPerBatch={8}
        windowSize={9}
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
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    backgroundColor: Brand.surface,
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
  composerActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  composerAction: {
    flex: 1,
  },
  filters: {
    marginHorizontal: -18,
    marginTop: 16,
    marginBottom: 8,
  },
  batchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: -18,
    marginBottom: 10,
  },
  batchLabel: {
    fontFamily: Type.bodyMedium,
    fontSize: 11,
    color: Brand.dim,
    paddingLeft: 18,
  },
  batchChips: {
    flex: 1,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    minHeight: 42,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    backgroundColor: Brand.surface,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontFamily: Type.body,
    fontSize: 13,
    color: Brand.ink,
    paddingVertical: 8,
  },
  searchSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${Brand.accent}55`,
    backgroundColor: Brand.accentSoft,
    marginBottom: 12,
  },
  searchSummaryText: {
    flex: 1,
    fontFamily: Type.body,
    fontSize: 12,
    color: Brand.muted,
  },
  searchSummaryQuery: {
    fontFamily: Type.bodySemiBold,
    color: Brand.ink,
  },
  clearText: {
    fontFamily: Type.bodyMedium,
    fontSize: 11.5,
    color: Brand.accent,
  },
  banner: {
    marginBottom: 12,
  },
  pinnedSection: {
    marginBottom: 18,
  },
  pinnedHint: {
    fontFamily: Type.body,
    fontSize: 10.5,
    color: Brand.dim,
  },
  pinnedList: {
    gap: 12,
    marginTop: 10,
  },
  slotNotice: {
    marginTop: 8,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    backgroundColor: Brand.elevated,
    fontFamily: Type.body,
    fontSize: 11.5,
    color: Brand.dim,
  },
  sectionHeader: {
    paddingTop: 10,
    paddingBottom: 10,
  },
  separator: {
    height: 12,
  },
});
