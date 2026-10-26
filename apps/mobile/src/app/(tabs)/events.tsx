'use client';

/**
 * Events tab — upcoming and live events with server-backed RSVPs.
 *
 * Ended events are excluded from this listing exactly as the website excludes
 * them from its calendar. They remain in the database and in the faculty
 * management dashboard. RSVP is disabled at the computed end instant.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { EVENT_SELECT, mapEvent } from '@/lib/community';
import { filterActiveEvents, isEventUpcoming, sortEventsByStart } from '@/lib/feed-logic';
import { logSupabaseError } from '@/lib/errors';
import { Brand, Type } from '@/lib/theme';
import type { Event } from '@/lib/types';
import { EventCard } from '@/components/event-card';
import { PageHeader, Screen } from '@/components/layout';
import { ListSkeleton } from '@/components/skeleton';
import { EmptyState, ErrorState } from '@/components/states';
import { PrimaryButton, StatusBanner } from '@/components/ui';

type EventSection = { title: string; data: Event[] };

export default function EventsScreen() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const [events, setEvents] = useState<Event[]>([]);
  const [rsvpIds, setRsvpIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const load = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      const minDate = new Date();
      minDate.setDate(minDate.getDate() - 2);
      const min = `${minDate.getFullYear()}-${String(minDate.getMonth() + 1).padStart(2, '0')}-${String(
        minDate.getDate()
      ).padStart(2, '0')}`;

      let result = await supabase
        .from('events')
        .select(EVENT_SELECT)
        .gte('event_date', min)
        .order('event_date', { ascending: true })
        .limit(60);

      if (result.error) {
        result = await supabase
          .from('events')
          .select('*')
          .gte('event_date', min)
          .order('event_date', { ascending: true })
          .limit(60);
      }

      if (result.error) {
        logSupabaseError('Events error', result.error);
        setError(result.error.message || 'Events could not be loaded.');
        setLoading(false);
        setRefreshing(false);
        return;
      }

      setEvents(((result.data ?? []) as unknown as Record<string, unknown>[]).map(mapEvent));
      setLoading(false);
      setRefreshing(false);

      if (userId) {
        const rsvps = await supabase.from('event_rsvps').select('event_id').eq('user_id', userId);
        if (!rsvps.error && rsvps.data) {
          setRsvpIds(new Set(rsvps.data.map((row) => String(row.event_id))));
        }
      } else {
        setRsvpIds(new Set());
      }
    },
    [userId]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const sections = useMemo<EventSection[]>(() => {
    const active = sortEventsByStart(filterActiveEvents(events, now));
    return active.length ? [{ title: 'Upcoming and live', data: active }] : [];
  }, [events, now]);

  const toggleRsvp = useCallback(
    async (event: Event) => {
      if (!userId || busyId) return;
      if (!isEventUpcoming(event)) return;
      setBusyId(event.id);
      setActionError(null);
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
      setBusyId(null);
    },
    [busyId, rsvpIds, userId]
  );

  const header = (
    <View>
      <PageHeader
        eyebrow="Department calendar"
        title="Events"
        subtitle="Workshops, seminars and project sessions across every CSE batch."
      />
      <View style={styles.headerActions}>
        <PrimaryButton
          label="Host event"
          icon="add"
          onPress={() => router.push('/create-event')}
        />
      </View>
      {actionError ? (
        <View style={styles.bannerWrap}>
          <StatusBanner kind="error">{actionError}</StatusBanner>
        </View>
      ) : null}
      {error && events.length > 0 ? (
        <View style={styles.bannerWrap}>
          <StatusBanner kind="warning">{error}</StatusBanner>
        </View>
      ) : null}
      {!loading && sections.length === 0 && !error ? (
        <EmptyState
          icon="calendar-outline"
          title="No events on the calendar"
          message="When faculty or students host a workshop, seminar or project session, it will appear here."
          action={
            <PrimaryButton
              label="Host an event"
              icon="add"
              onPress={() => router.push('/create-event')}
            />
          }
        />
      ) : null}
    </View>
  );

  return (
    <Screen>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <EventCard
            event={item}
            going={rsvpIds.has(item.id)}
            busy={busyId === item.id}
            now={now}
            onToggleRsvp={() => void toggleRsvp(item)}
            onPress={() => router.push({ pathname: '/event/[id]', params: { id: item.id } })}
          />
        )}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <Text style={styles.sectionCount}>{section.data.length}</Text>
          </View>
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={
          loading ? (
            <ListSkeleton count={3} />
          ) : error ? (
            <ErrorState message={error} onRetry={() => void load()} />
          ) : undefined
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        SectionSeparatorComponent={() => <View style={styles.sectionSeparator} />}
        contentContainerStyle={styles.content}
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(true)}
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
  headerActions: {
    marginBottom: 14,
  },
  bannerWrap: {
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 10,
    paddingBottom: 10,
  },
  sectionTitle: {
    fontFamily: Type.bodySemiBold,
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: Brand.dim,
  },
  sectionCount: {
    fontFamily: Type.bodyMedium,
    fontSize: 10.5,
    color: Brand.dim,
    backgroundColor: Brand.elevated,
    borderRadius: 9,
    paddingHorizontal: 6,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  separator: {
    height: 12,
  },
  sectionSeparator: {
    height: 6,
  },
});
