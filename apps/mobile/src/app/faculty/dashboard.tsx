'use client';

/**
 * Faculty workspace — mobile parity with `/faculty/dashboard`.
 *
 * Shows every event the signed-in host owns (including ended events, which are
 * hidden only from public listings) and every announcement they authored.
 * Announcements support create, edit, delete and images; events support edit
 * and delete. The website APIs remain the authorization boundary for uploads,
 * CSV export and admin review.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';

import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { EVENT_SELECT, mapAnnouncement, mapEvent, formatRelativeTime } from '@/lib/community';
import { canPublishFacultyContent, canExportCommunityActivity, isAdmin } from '@/lib/profile';
import { logSupabaseError } from '@/lib/errors';
import { WebsiteApiError, websiteJson } from '@/lib/website-api';
import { Brand, Type } from '@/lib/theme';
import type { Announcement, Event } from '@/lib/types';
import { CommunityActivityExport } from '@/components/community-activity-export';
import { EventCard } from '@/components/event-card';
import { PageHeader, Screen } from '@/components/layout';
import { ListSkeleton } from '@/components/skeleton';
import { EmptyState, ErrorState } from '@/components/states';
import {
  ActionButton,
  GhostButton,
  PrimaryButton,
  SectionLabel,
  StatusBanner,
} from '@/components/ui';

export default function FacultyDashboardScreen() {
  const { session, profile, loading: authLoading } = useAuth();
  const userId = session?.user.id ?? null;
  const canPublish = canPublishFacultyContent(profile);

  const [events, setEvents] = useState<Event[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const deletingRef = useRef<Set<string>>(new Set());
  const [now] = useState(() => new Date());

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!userId) {
        setLoading(false);
        return;
      }
      if (mode === 'refresh') setRefreshing(true);
      else setLoading(true);
      setError(null);

      const [eventsResult, announcementsResult] = await Promise.all([
        supabase
          .from('events')
          .select(EVENT_SELECT)
          .eq('host_id', userId)
          .order('event_date', { ascending: false })
          .limit(30),
        supabase
          .from('announcements')
          .select('id, author_id, title, body, image_urls, created_at, updated_at')
          .eq('author_id', userId)
          .order('created_at', { ascending: false })
          .limit(30),
      ]);

      let eventRows = eventsResult.data as unknown as Record<string, unknown>[] | null;
      let eventError = eventsResult.error;
      if (eventError) {
        const fallback = await supabase
          .from('events')
          .select('*')
          .eq('host_id', userId)
          .order('event_date', { ascending: false })
          .limit(30);
        eventRows = fallback.data as unknown as Record<string, unknown>[] | null;
        eventError = fallback.error;
      }

      if (eventError) logSupabaseError('Faculty events error', eventError);
      if (announcementsResult.error) {
        logSupabaseError('Faculty announcements error', announcementsResult.error);
      }

      const failure = eventError ?? announcementsResult.error;
      if (failure) {
        setError(failure.message || 'Your faculty content could not be loaded.');
      }

      setEvents(eventRows ? eventRows.map(mapEvent) : []);
      setAnnouncements(
        announcementsResult.data
          ? (announcementsResult.data as unknown as Record<string, unknown>[]).map(mapAnnouncement)
          : []
      );
      setLoading(false);
      setRefreshing(false);
    },
    [userId]
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const deleteAnnouncement = useCallback(
    (announcement: Announcement) => {
      if (deletingRef.current.has(announcement.id)) return;
      Alert.alert(
        'Delete announcement',
        `Delete “${announcement.title}”? This cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              if (deletingRef.current.has(announcement.id)) return;
              deletingRef.current.add(announcement.id);
              setBusyId(announcement.id);
              setActionError(null);
              try {
                await websiteJson<{ deleted?: boolean }>(
                  `/api/announcements/${encodeURIComponent(announcement.id)}`,
                  { method: 'DELETE', headers: { Accept: 'application/json' } }
                );
                setAnnouncements((previous) =>
                  previous.filter((item) => item.id !== announcement.id)
                );
              } catch (deleteError) {
                if (deleteError instanceof WebsiteApiError && deleteError.status === 404) {
                  setAnnouncements((previous) =>
                    previous.filter((item) => item.id !== announcement.id)
                  );
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
                setBusyId(null);
              }
            },
          },
        ]
      );
    },
    []
  );

  const deleteEvent = useCallback(
    (event: Event) => {
      if (deletingRef.current.has(event.id)) return;
      Alert.alert('Delete event', 'Delete this event? This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (deletingRef.current.has(event.id)) return;
            deletingRef.current.add(event.id);
            setBusyId(event.id);
            setActionError(null);
            try {
              const { data, error: deleteError } = await supabase
                .from('events')
                .delete()
                .eq('id', event.id)
                .select('id');

              if (deleteError) {
                setActionError(deleteError.message);
                return;
              }
              if (!data || data.length === 0) {
                setActionError(
                  'The event could not be deleted. You may not have permission to delete it.'
                );
                return;
              }
              setEvents((previous) => previous.filter((item) => item.id !== event.id));
            } finally {
              deletingRef.current.delete(event.id);
              setBusyId(null);
            }
          },
        },
      ]);
    },
    []
  );

  const announcementCount = useMemo(() => announcements.length, [announcements]);

  if (authLoading) {
    return (
      <Screen>
        <PageHeader eyebrow="Faculty workspace" title="Dashboard" subtitle="Loading your workspace…" />
        <View style={styles.loadingWrap}>
          <ListSkeleton count={3} />
        </View>
      </Screen>
    );
  }

  if (!canPublish) {
    return (
      <Screen>
        <PageHeader eyebrow="Faculty workspace" title="Dashboard" subtitle="Faculty access required" />
        <EmptyState
          icon="lock-closed-outline"
          title="Access denied"
          message="Faculty verification is required to open the faculty workspace. Contact an administrator if you believe this is a mistake."
          action={<GhostButton label="Go back" onPress={() => router.back()} />}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load('refresh')}
            tintColor={Brand.accent}
            colors={[Brand.accent]}
            progressBackgroundColor={Brand.surface}
          />
        }
      >
        <PageHeader
          eyebrow="Faculty workspace"
          title="Dashboard"
          subtitle="Publish announcements, manage your events and export community activity."
          right={
            <ActionButton
              label="Refresh"
              icon="refresh"
              onPress={() => void load('refresh')}
              busy={refreshing}
            />
          }
        />

        <View style={styles.actions}>
          <PrimaryButton
            label="New announcement"
            icon="megaphone-outline"
            onPress={() => router.push('/announcements/create')}
          />
          <GhostButton
            label="New event"
            icon="calendar-outline"
            onPress={() => router.push('/create-event')}
          />
          <GhostButton
            label="Open channel"
            icon="open-outline"
            onPress={() => router.push('/announcements')}
          />
        </View>

        {isAdmin(profile) ? (
          <View style={styles.adminLink}>
            <GhostButton
              label="Admin review"
              icon="shield-checkmark-outline"
              onPress={() => router.push('/admin')}
            />
          </View>
        ) : null}

        {canExportCommunityActivity(profile) ? <CommunityActivityExport /> : null}

        {actionError ? <StatusBanner kind="error">{actionError}</StatusBanner> : null}

        {loading ? (
          <ListSkeleton count={3} />
        ) : error ? (
          <ErrorState
            title="Workspace unavailable"
            message={error}
            onRetry={() => void load()}
            retrying={refreshing}
          />
        ) : (
          <>
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <SectionLabel>Announcements</SectionLabel>
                <Text style={styles.count}>{announcementCount}</Text>
              </View>

              {announcements.length === 0 ? (
                <EmptyState
                  icon="megaphone-outline"
                  title="No announcements yet"
                  message="Publish your first announcement to reach students in the community feed."
                  action={
                    <GhostButton
                      label="Create announcement"
                      icon="add"
                      onPress={() => router.push('/announcements/create')}
                    />
                  }
                />
              ) : (
                <View style={styles.cardList}>
                  {announcements.map((announcement) => (
                    <View key={announcement.id} style={styles.announcementCard}>
                      <Text style={styles.announcementTitle}>{announcement.title}</Text>
                      <Text style={styles.announcementBody} numberOfLines={3}>
                        {announcement.body}
                      </Text>
                      <View style={styles.metaRow}>
                        <Ionicons name="time-outline" size={13} color={Brand.dim} />
                        <Text style={styles.meta}>
                          Posted {formatRelativeTime(announcement.created_at)}
                          {announcement.image_urls.length > 0
                            ? ` · ${announcement.image_urls.length} image${
                                announcement.image_urls.length === 1 ? '' : 's'
                              }`
                            : ''}
                        </Text>
                      </View>
                      <View style={styles.rowActions}>
                        <ActionButton
                          label="Edit"
                          icon="create-outline"
                          onPress={() =>
                            router.push({
                              pathname: '/announcements/edit',
                              params: { id: announcement.id },
                            })
                          }
                          disabled={busyId === announcement.id}
                        />
                        <ActionButton
                          label="Delete"
                          icon="trash-outline"
                          tone="danger"
                          onPress={() => deleteAnnouncement(announcement)}
                          busy={busyId === announcement.id}
                        />
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <SectionLabel>Your events</SectionLabel>
                <Text style={styles.count}>{events.length}</Text>
              </View>
              <Text style={styles.sectionCopy}>
                Events stay here even after they end, with their RSVP totals. Ended events are
                hidden from the public calendar and feed.
              </Text>

              {events.length === 0 ? (
                <EmptyState
                  icon="calendar-outline"
                  title="No events yet"
                  message="Events you create will appear here with their RSVP counts."
                  action={
                    <GhostButton
                      label="Host an event"
                      icon="add"
                      onPress={() => router.push('/create-event')}
                    />
                  }
                />
              ) : (
                <View style={styles.eventList}>
                  {events.map((event) => (
                    <EventCard
                      key={event.id}
                      event={event}
                      now={now}
                      busy={busyId === event.id}
                      onPress={() =>
                        router.push({ pathname: '/event/[id]', params: { id: event.id } })
                      }
                      onEdit={() =>
                        router.push({ pathname: '/create-event', params: { id: event.id } })
                      }
                      onDelete={() => deleteEvent(event)}
                    />
                  ))}
                </View>
              )}
            </View>
          </>
        )}

        <Text style={styles.footer}>
          <Ionicons name="shield-checkmark-outline" size={12} color={Brand.dim} /> Only approved
          faculty and admins can publish. The database enforces this for every action.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 36,
    gap: 18,
  },
  loadingWrap: {
    paddingHorizontal: 18,
  },
  actions: {
    paddingHorizontal: 18,
    gap: 8,
  },
  adminLink: {
    paddingHorizontal: 18,
    flexDirection: 'row',
  },
  section: {
    paddingHorizontal: 18,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  count: {
    fontFamily: Type.bodyMedium,
    fontSize: 11,
    color: Brand.dim,
    backgroundColor: Brand.elevated,
    borderRadius: 9,
    paddingHorizontal: 7,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  sectionCopy: {
    fontFamily: Type.body,
    fontSize: 11.5,
    lineHeight: 17,
    color: Brand.dim,
    marginTop: 6,
    marginBottom: 10,
  },
  cardList: {
    gap: 10,
    marginTop: 10,
  },
  announcementCard: {
    backgroundColor: Brand.surface,
    borderColor: Brand.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 13,
    padding: 14,
  },
  announcementTitle: {
    fontFamily: Type.bodySemiBold,
    fontSize: 14,
    lineHeight: 19,
    color: Brand.ink,
  },
  announcementBody: {
    fontFamily: Type.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Brand.muted,
    marginTop: 5,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 9,
  },
  meta: {
    fontFamily: Type.body,
    fontSize: 10.5,
    color: Brand.dim,
  },
  rowActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 10,
    paddingTop: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Brand.line,
  },
  eventList: {
    gap: 12,
    marginTop: 10,
  },
  footer: {
    fontFamily: Type.body,
    fontSize: 10.5,
    lineHeight: 16,
    color: Brand.dim,
    textAlign: 'center',
    paddingHorizontal: 28,
  },
});
