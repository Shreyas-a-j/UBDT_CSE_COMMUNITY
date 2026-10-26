'use client';

/**
 * Announcements channel — the mobile equivalent of `/announcements`.
 *
 * Faculty announcements are institutional and batch-agnostic, so there is no
 * batch filter here. Members may filter by author and group by day, and
 * signed-in members can react. Publishing is limited to approved faculty by
 * RLS; the composer is only shown to them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';

import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { ANNOUNCEMENT_SELECT, mapAnnouncement } from '@/lib/community';
import { canDeleteAnnouncement, groupAnnouncementsByDay } from '@/lib/feed-logic';
import { canPublishFacultyContent } from '@/lib/profile';
import { WebsiteApiError, websiteJson } from '@/lib/website-api';
import { logSupabaseError } from '@/lib/errors';
import { Brand, Type } from '@/lib/theme';
import type { Announcement, AnnouncementReaction } from '@/lib/types';
import { Avatar } from '@/components/avatar';
import { BackHeader, Screen } from '@/components/layout';
import { AnnouncementCard } from '@/components/announcement-card';
import { ListSkeleton } from '@/components/skeleton';
import { EmptyState, ErrorState } from '@/components/states';
import { GhostButton, PrimaryButton, StatusBanner } from '@/components/ui';

interface AuthorSummary {
  id: string;
  name: string;
  avatar: string | null;
  designation: string | null;
  count: number;
}

export default function AnnouncementsScreen() {
  const { profile, session } = useAuth();
  const userId = session?.user.id ?? null;

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [authorFilter, setAuthorFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [clock, setClock] = useState<Date | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const deletingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const timer = setTimeout(() => setClock(new Date()), 0);
    return () => clearTimeout(timer);
  }, []);

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'refresh') setRefreshing(true);
    else setLoading(true);
    setError(null);

    let result = await supabase
      .from('announcements')
      .select(ANNOUNCEMENT_SELECT)
      .order('created_at', { ascending: false })
      .limit(80);

    if (result.error) {
      result = await supabase
        .from('announcements')
        .select('*, author:profiles!author_id (id, name, avatar_url, designation)')
        .order('created_at', { ascending: false })
        .limit(80);
    }

    if (result.error) {
      logSupabaseError('Announcements error', result.error);
      const message = result.error.message.toLowerCase();
      if (!message.includes('does not exist') && !message.includes('schema cache')) {
        setError(result.error.message || 'Announcements could not be loaded.');
      }
      setAnnouncements([]);
    } else {
      setAnnouncements(
        ((result.data ?? []) as unknown as Record<string, unknown>[]).map(mapAnnouncement)
      );
    }

    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hasFocused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (hasFocused.current) void load('refresh');
      else hasFocused.current = true;
    }, [load])
  );

  const confirmDelete = useCallback(async (announcement: Announcement) => {
    if (deletingRef.current.has(announcement.id)) return;
    deletingRef.current.add(announcement.id);
    setDeletingIds(new Set(deletingRef.current));
    setActionError(null);
    try {
      await websiteJson<{ deleted?: boolean }>(
        `/api/announcements/${encodeURIComponent(announcement.id)}`,
        { method: 'DELETE', headers: { Accept: 'application/json' } }
      );
      setAnnouncements((previous) => previous.filter((row) => row.id !== announcement.id));
    } catch (deleteError) {
      if (deleteError instanceof WebsiteApiError && deleteError.status === 404) {
        setAnnouncements((previous) => previous.filter((row) => row.id !== announcement.id));
        setActionError('The announcement was already gone.');
      } else {
        setActionError(
          deleteError instanceof Error
            ? deleteError.message
            : 'The announcement could not be deleted.'
        );
      }
    } finally {
      deletingRef.current.delete(announcement.id);
      setDeletingIds(new Set(deletingRef.current));
    }
  }, []);

  const requestDelete = useCallback(
    (announcement: Announcement) => {
      if (!canDeleteAnnouncement(profile, announcement.author_id)) return;
      if (deletingRef.current.has(announcement.id)) return;
      Alert.alert(
        'Delete announcement',
        `Delete “${announcement.title}”? This cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              void confirmDelete(announcement);
            },
          },
        ]
      );
    },
    [confirmDelete, profile]
  );

  const authors = useMemo<AuthorSummary[]>(() => {
    const byAuthor = new Map<string, AuthorSummary>();
    for (const announcement of announcements) {
      const existing = byAuthor.get(announcement.author_id);
      if (existing) {
        existing.count += 1;
        continue;
      }
      byAuthor.set(announcement.author_id, {
        id: announcement.author_id,
        name: announcement.author_name || 'CSE Faculty',
        avatar: announcement.author_avatar ?? null,
        designation: announcement.author_designation ?? null,
        count: 1,
      });
    }
    return Array.from(byAuthor.values()).sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name)
    );
  }, [announcements]);

  const visible = useMemo(
    () =>
      authorFilter
        ? announcements.filter((announcement) => announcement.author_id === authorFilter)
        : announcements,
    [announcements, authorFilter]
  );

  const groups = useMemo(
    () => (clock ? groupAnnouncementsByDay(visible, clock) : []),
    [visible, clock]
  );

  const sections = useMemo(
    () =>
      groups.map((group) => ({
        key: group.key,
        title: group.label,
        data: group.announcements,
      })),
    [groups]
  );

  const activeAuthor = authors.find((author) => author.id === authorFilter) ?? null;
  const canPublish = canPublishFacultyContent(profile);

  const toggleReaction = async (announcementId: string, reaction: AnnouncementReaction) => {
    if (!userId) return;
    const existing = announcements.find((item) => item.id === announcementId);
    const previousReaction =
      existing?.reactions.find((row) => row.user_id === userId)?.reaction ?? null;
    const nextReaction = previousReaction === reaction ? null : reaction;

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
  };

  const header = (
    <View>
      <BackHeader title="Announcements" subtitle="Faculty channel" />
      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.hash}>
            <Ionicons name="megaphone-outline" size={18} color={Brand.accent} />
          </View>
          <View style={styles.heroText}>
            <Text style={styles.heroTitle}>announcements</Text>
            <Text style={styles.heroSubtitle}>
              Official updates from the Department of Computer Science & Engineering.
              Department-wide, so they stay visible whichever batch you browse.
            </Text>
          </View>
        </View>
        <View style={styles.heroActions}>
          {canPublish ? (
            <PrimaryButton
              label="New announcement"
              icon="create-outline"
              onPress={() => router.push('/announcements/create')}
            />
          ) : (
            <View style={styles.lockNote}>
              <Ionicons name="lock-closed-outline" size={13} color={Brand.dim} />
              <Text style={styles.lockText}>Faculty post updates</Text>
            </View>
          )}
        </View>
        <Text style={styles.heroMeta}>
          {announcements.length} update{announcements.length === 1 ? '' : 's'} · Signed-in members can react
        </Text>
      </View>

      {actionError ? <StatusBanner kind="error">{actionError}</StatusBanner> : null}
      {error ? <StatusBanner kind="warning">{error}</StatusBanner> : null}

      <View style={styles.authorRail}>
        <Text style={styles.railLabel}>Posting faculty</Text>
        <View style={styles.authorChips}>
          <Pressable
            onPress={() => setAuthorFilter(null)}
            accessibilityRole="button"
            accessibilityState={{ selected: authorFilter === null }}
            style={({ pressed }) => [
              styles.authorChip,
              authorFilter === null && styles.authorChipActive,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="megaphone-outline" size={13} color={Brand.accent} />
            <Text style={[styles.authorChipText, authorFilter === null && styles.authorChipTextActive]}>
              All updates
            </Text>
            <Text style={styles.authorCount}>{announcements.length}</Text>
          </Pressable>
          {authors.map((author) => {
            const active = authorFilter === author.id;
            return (
              <Pressable
                key={author.id}
                onPress={() => setAuthorFilter(active ? null : author.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [
                  styles.authorChip,
                  active && styles.authorChipActive,
                  pressed && styles.pressed,
                ]}
              >
                <Avatar name={author.name} uri={author.avatar} size={20} />
                <Text style={[styles.authorChipText, active && styles.authorChipTextActive]} numberOfLines={1}>
                  {author.name}
                </Text>
                <Text style={styles.authorCount}>{author.count}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.channelHeading}>
        <Text style={styles.channelTitle} numberOfLines={1}>
          {activeAuthor ? activeAuthor.name : 'All announcements'}
        </Text>
        {activeAuthor?.designation ? (
          <Text style={styles.channelMeta}>{activeAuthor.designation}</Text>
        ) : null}
        {authorFilter ? (
          <GhostButton label="Clear filter" onPress={() => setAuthorFilter(null)} />
        ) : null}
      </View>
    </View>
  );

  return (
    <Screen>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.messageWrap}>
            <AnnouncementCard
              announcement={item}
              viewerId={userId}
              variant="message"
              onToggleReaction={(reaction) => void toggleReaction(item.id, reaction)}
              onDelete={
                canDeleteAnnouncement(profile, item.author_id)
                  ? () => requestDelete(item)
                  : undefined
              }
              deleting={deletingIds.has(item.id)}
            />
          </View>
        )}
        renderSectionHeader={({ section }) => (
          <View style={styles.dayHeader}>
            <View style={styles.dayLine} />
            <Text style={styles.dayLabel}>{section.title}</Text>
            <View style={styles.dayLine} />
          </View>
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={
          loading ? (
            <ListSkeleton count={3} />
          ) : error ? (
            <ErrorState
              title="Announcements unavailable"
              message={error}
              onRetry={() => void load()}
            />
          ) : (
            <EmptyState
              icon="megaphone-outline"
              title={authorFilter ? 'Nothing from this faculty member yet' : 'No announcements yet'}
              message={
                authorFilter
                  ? 'Try clearing the filter to see every update in the channel.'
                  : 'Faculty updates will appear here as soon as they are published.'
              }
              action={
                canPublish ? (
                  <PrimaryButton
                    label="Write the first one"
                    icon="create-outline"
                    onPress={() => router.push('/announcements/create')}
                  />
                ) : undefined
              }
            />
          )
        }
        contentContainerStyle={styles.content}
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load('refresh')}
            tintColor={Brand.accent}
            colors={[Brand.accent]}
            progressBackgroundColor={Brand.surface}
          />
        }
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 18,
    paddingBottom: 30,
  },
  hero: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    backgroundColor: Brand.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    gap: 12,
  },
  heroTop: {
    flexDirection: 'row',
    gap: 11,
  },
  hash: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${Brand.accent}55`,
    backgroundColor: Brand.accentSoft,
  },
  heroText: {
    flex: 1,
    minWidth: 0,
  },
  heroTitle: {
    fontFamily: Type.display,
    fontSize: 24,
    lineHeight: 30,
    color: Brand.ink,
  },
  heroSubtitle: {
    fontFamily: Type.body,
    fontSize: 12.5,
    lineHeight: 19,
    color: Brand.muted,
    marginTop: 4,
  },
  heroActions: {
    alignItems: 'flex-start',
  },
  lockNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    backgroundColor: Brand.elevated,
  },
  lockText: {
    fontFamily: Type.bodyMedium,
    fontSize: 11.5,
    color: Brand.muted,
  },
  heroMeta: {
    fontFamily: Type.body,
    fontSize: 11,
    color: Brand.dim,
  },
  authorRail: {
    marginBottom: 10,
  },
  railLabel: {
    fontFamily: Type.bodySemiBold,
    fontSize: 10.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Brand.dim,
    marginBottom: 7,
  },
  authorChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  authorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    backgroundColor: Brand.surface,
  },
  authorChipActive: {
    borderColor: Brand.accent,
    backgroundColor: Brand.accentSoft,
  },
  authorChipText: {
    maxWidth: 140,
    fontFamily: Type.bodyMedium,
    fontSize: 11.5,
    color: Brand.muted,
  },
  authorChipTextActive: {
    color: Brand.accent,
  },
  authorCount: {
    fontFamily: Type.body,
    fontSize: 10.5,
    color: Brand.dim,
  },
  channelHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Brand.line,
  },
  channelTitle: {
    fontFamily: Type.bodySemiBold,
    fontSize: 13,
    color: Brand.ink,
  },
  channelMeta: {
    fontFamily: Type.body,
    fontSize: 11,
    color: Brand.dim,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  dayLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: Brand.line,
  },
  dayLabel: {
    fontFamily: Type.bodySemiBold,
    fontSize: 10.5,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: Brand.dim,
  },
  messageWrap: {
    paddingHorizontal: 2,
  },
  pressed: {
    opacity: 0.65,
  },
});
